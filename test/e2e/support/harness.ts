import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assemblyStatusSchema } from "@transloadit/zod/v3/assemblyStatus";
import { build } from "esbuild";
import { readRequestBody } from "./http.js";
import { startTunnel } from "./tunnel.js";
import { parseWebhookPayload, type WebhookPayload } from "./webhook.js";

type AppVariant = "fixture" | "example";

type HarnessOptions = {
  appVariant: AppVariant;
  useTemplate: boolean;
  templateId: string;
  useRemote: boolean;
  remoteUrl: string;
  remoteNotifyUrl: string;
  runAction: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  runQuery: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onWebhook: (payload: WebhookPayload) => void;
  onWebhookError: (error: unknown) => void;
};

type Harness = {
  serverUrl: string;
  notifyUrl: string;
  close: () => Promise<void>;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const aliasPlugin = (aliases: Record<string, string>) => ({
  name: "alias",
  setup(buildInstance: Parameters<typeof build>[0]) {
    for (const [from, to] of Object.entries(aliases)) {
      const filter = new RegExp(`^${escapeRegex(from)}$`);
      buildInstance.onResolve({ filter }, () => ({ path: to }));
    }
  },
});

const buildFixtureBundle = async (options: {
  appVariant: AppVariant;
  notifyUrl: string;
  templateId: string;
  bundlePath: string;
  fixturesDir: string;
}) => {
  const fixtureEntry = join(options.fixturesDir, "app.tsx");
  const exampleEntry = join(options.fixturesDir, "example-entry.tsx");
  const convexStubPath = join(options.fixturesDir, "convex-react-stub.js");
  const apiStubPath = join(options.fixturesDir, "api-stub.ts");
  const exampleApiPath = resolve("example/convex/_generated/api");
  const entryPoint =
    options.appVariant === "example" ? exampleEntry : fixtureEntry;

  const aliases: Record<string, string> = {
    "convex/react": convexStubPath,
  };
  aliases[exampleApiPath] = apiStubPath;

  const define: Record<string, string> = {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": "{}",
  };

  if (options.appVariant === "example") {
    define["import.meta.env.VITE_TRANSLOADIT_TEMPLATE_ID"] = JSON.stringify(
      options.templateId,
    );
    define["import.meta.env.VITE_TRANSLOADIT_NOTIFY_URL"] = JSON.stringify(
      options.notifyUrl,
    );
  }

  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: options.bundlePath,
    logLevel: "silent",
    define,
    plugins: [aliasPlugin(aliases)],
  });
};

const deriveNotifyUrl = (remoteUrl: string, remoteNotifyUrl: string) => {
  if (remoteNotifyUrl) return remoteNotifyUrl;
  const match = /https:\/\/([a-z0-9-]+)\.convex\.cloud/i.exec(remoteUrl);
  if (!match?.[1]) {
    throw new Error("Unable to derive notifyUrl from E2E_REMOTE_URL");
  }
  return `https://${match[1]}.convex.site/transloadit/webhook`;
};

export const setupHarness = async (
  options: HarnessOptions,
): Promise<Harness> => {
  const fixturesDir = resolve("test/e2e/fixtures");
  const indexTemplate = await readFile(join(fixturesDir, "index.html"), "utf8");
  const bundleDir = await mkdtemp(join(tmpdir(), "transloadit-e2e-bundle-"));
  const bundlePath = join(bundleDir, "app.js");

  if (options.appVariant === "example" && !options.templateId) {
    throw new Error("Missing templateId for example e2e app");
  }

  let notifyUrl = "";
  let serverUrl = "";
  let tunnelProcess: ReturnType<typeof startTunnel>["process"] | null = null;

  const steps = {
    ":original": {
      robot: "/upload/handle",
    },
    resize: {
      use: ":original",
      robot: "/image/resize",
      width: 320,
      height: 320,
      resize_strategy: "fit",
      result: true,
    },
  };

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");

    if (method === "GET" && url.pathname === "/") {
      const html = indexTemplate.replace(
        "__NOTIFY_URL__",
        JSON.stringify(notifyUrl),
      );
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }

    if (method === "GET" && url.pathname === "/fixtures/app.js") {
      try {
        const file = await readFile(bundlePath);
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(file);
      } catch {
        res.writeHead(500);
        res.end("Missing bundle");
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/action") {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString("utf8")) as {
        name?: string;
        args?: Record<string, unknown>;
      };

      if (payload.name !== "createAssembly") {
        res.writeHead(404);
        res.end("Unknown action");
        return;
      }

      const args = payload.args ?? {};
      const resolvedTemplateId = options.useTemplate
        ? typeof args.templateId === "string" && args.templateId
          ? args.templateId
          : options.templateId || undefined
        : undefined;

      const actionResult = await options.runAction("createAssembly", {
        steps,
        templateId: resolvedTemplateId,
        notifyUrl:
          typeof args.notifyUrl === "string" ? args.notifyUrl : notifyUrl,
        numExpectedUploadFiles: 1,
        fields: args.fields,
        expires: args.expires,
        additionalParams: args.additionalParams,
        userId: args.userId,
      });

      const assemblyData = (actionResult as { data?: unknown })?.data;
      if (!assemblyData || typeof assemblyData !== "object") {
        throw new Error("Missing Transloadit assembly data");
      }
      assemblyStatusSchema.parse(assemblyData);

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(actionResult));
      return;
    }

    if (method === "POST" && url.pathname === "/api/query") {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString("utf8")) as {
        name?: string;
        args?: Record<string, unknown>;
      };

      if (payload.name === "getAssemblyStatus") {
        const assemblyId = payload.args?.assemblyId;
        if (typeof assemblyId !== "string" || !assemblyId) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("null");
          return;
        }
        const result = await options.runQuery("getAssemblyStatus", {
          assemblyId,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (payload.name === "listResults") {
        const result = await options.runQuery(
          "listResults",
          payload.args ?? {},
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404);
      res.end("Unknown query");
      return;
    }

    if (method === "POST" && url.pathname === "/transloadit/webhook") {
      const body = await readRequestBody(req);

      let payload: WebhookPayload;
      let rawPayload = "";
      let signature = "";
      try {
        ({ payload, rawPayload, signature } = parseWebhookPayload(req, body));
      } catch (error) {
        res.writeHead(400);
        res.end(
          error instanceof Error ? error.message : "Invalid webhook payload",
        );
        return;
      }

      try {
        assemblyStatusSchema.parse(payload);
        await options.runAction("handleWebhook", {
          payload,
          rawBody: rawPayload,
          signature,
          verifySignature: true,
        });
        options.onWebhook(payload);
      } catch (error) {
        options.onWebhookError(error);
        console.error("Webhook handler failed", error);
        res.writeHead(500);
        res.end("Webhook handler failed");
        return;
      }

      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, () => resolvePromise());
  });

  const address = server.address() as AddressInfo;
  serverUrl = `http://localhost:${address.port}`;

  if (options.useRemote) {
    notifyUrl = deriveNotifyUrl(options.remoteUrl, options.remoteNotifyUrl);
  } else {
    const tunnel = await startTunnel(address.port);
    tunnelProcess = tunnel.process;
    notifyUrl =
      tunnel.info.notifyUrl ?? `${tunnel.info.url}/transloadit/webhook`;
  }

  await buildFixtureBundle({
    appVariant: options.appVariant,
    notifyUrl,
    templateId: options.templateId,
    bundlePath,
    fixturesDir,
  });

  const close = async () => {
    await new Promise((resolvePromise) =>
      server.close(() => resolvePromise(null)),
    );

    if (tunnelProcess && tunnelProcess.exitCode === null) {
      tunnelProcess.kill();
      await new Promise((resolvePromise) => {
        const fallback = setTimeout(() => {
          tunnelProcess?.kill("SIGKILL");
          resolvePromise(null);
        }, 3000);
        tunnelProcess.once("exit", () => {
          clearTimeout(fallback);
          resolvePromise(null);
        });
      });
    }
  };

  return { serverUrl, notifyUrl, close };
};
