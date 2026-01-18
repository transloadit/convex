import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { assemblyStatusSchema } from "@transloadit/zod/v3/assemblyStatus";
import { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api } from "../../src/component/_generated/api.js";
import schema from "../../src/component/schema.js";
import { modules } from "../../src/component/setup.test.js";
import { parseMultipart, readRequestBody } from "./support/http.js";
import { runtime } from "./support/runtime.js";
import { startTunnel } from "./support/tunnel.js";

const {
  authKey,
  authSecret,
  useRemote,
  remoteUrl,
  remoteAdminKey,
  remoteNotifyUrl,
  appVariant,
  templateId,
  useTemplate,
  shouldRun,
} = runtime;

const fixturesDir = resolve("test/e2e/fixtures");
const distDir = resolve("dist");

const describeE2e = shouldRun ? describe : describe.skip;

type WebhookPayload = {
  ok?: string;
  assembly_id?: string;
  [key: string]: unknown;
};

describeE2e("e2e upload flow", () => {
  let serverUrl = "";
  let notifyUrl = "";
  let tunnelProcess: ReturnType<typeof spawn> | null = null;
  let server: ReturnType<typeof createServer> | null = null;
  let bundlePath = "";
  let webhookCount = 0;
  let lastWebhookPayload: WebhookPayload | null = null;
  let lastWebhookError: unknown = null;

  const t = useRemote ? null : convexTest(schema, modules);
  let remoteClient: ConvexHttpClient | null = null;

  const runAction = async (name: string, args: Record<string, unknown>) => {
    if (remoteClient) {
      return remoteClient.action(`transloadit:${name}`, args);
    }

    if (!t) {
      throw new Error("Missing Convex test harness");
    }

    const config = authKey && authSecret ? { authKey, authSecret } : undefined;

    if (name === "createAssembly") {
      return t.action(api.lib.createAssembly, { ...args, config });
    }
    if (name === "handleWebhook") {
      return t.action(api.lib.handleWebhook, {
        ...args,
        config: config ? { authSecret: config.authSecret } : undefined,
      });
    }
    if (name === "refreshAssembly") {
      return t.action(api.lib.refreshAssembly, { ...args, config });
    }

    throw new Error(`Unknown action ${name}`);
  };

  const runQuery = async (name: string, args: Record<string, unknown>) => {
    if (remoteClient) {
      return remoteClient.query(`transloadit:${name}`, args);
    }

    if (!t) {
      throw new Error("Missing Convex test harness");
    }

    if (name === "getAssemblyStatus") {
      return t.query(api.lib.getAssemblyStatus, {
        assemblyId: args.assemblyId as string,
      });
    }
    if (name === "listResults") {
      return t.query(api.lib.listResults, args);
    }

    throw new Error(`Unknown query ${name}`);
  };

  beforeAll(async () => {
    const distEntry = join(distDir, "react", "index.js");
    if (!existsSync(distEntry)) {
      throw new Error(
        "Missing dist artifacts. Run `yarn build` before running e2e tests.",
      );
    }

    if (useRemote) {
      if (!remoteUrl || !remoteAdminKey) {
        throw new Error(
          "Missing E2E_REMOTE_URL or E2E_REMOTE_ADMIN_KEY for real mode",
        );
      }
      remoteClient = new ConvexHttpClient(remoteUrl, { logger: false });
      remoteClient.setAdminAuth(remoteAdminKey);
      remoteClient.setDebug(false);
    }

    const indexTemplate = await readFile(
      join(fixturesDir, "index.html"),
      "utf8",
    );
    const convexStubPath = join(fixturesDir, "convex-react-stub.js");
    const fixtureEntry = join(fixturesDir, "app.tsx");
    const exampleEntry = join(fixturesDir, "example-entry.tsx");
    const apiStubPath = join(fixturesDir, "api-stub.ts");
    const exampleApiPath = resolve("example/convex/_generated/api");
    const bundleDir = await mkdtemp(join(tmpdir(), "transloadit-e2e-bundle-"));
    bundlePath = join(bundleDir, "app.js");
    const entryPoint = appVariant === "example" ? exampleEntry : fixtureEntry;

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

    server = createServer(async (req, res) => {
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
        const resolvedTemplateId = useTemplate
          ? typeof args.templateId === "string" && args.templateId
            ? args.templateId
            : templateId || undefined
          : undefined;

        const actionResult = await runAction("createAssembly", {
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
          const result = await runQuery("getAssemblyStatus", { assemblyId });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }

        if (payload.name === "listResults") {
          const assemblyId = payload.args?.assemblyId;
          if (typeof assemblyId !== "string" || !assemblyId) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end("[]");
            return;
          }
          const result = await runQuery("listResults", { assemblyId });
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
        const contentType = req.headers["content-type"] || "";

        let rawPayload = "";
        let signature = "";
        let payload: WebhookPayload | undefined;

        if (contentType.includes("multipart/form-data")) {
          const fields = parseMultipart(body, contentType);
          rawPayload = fields.transloadit ?? "";
          signature = fields.signature ?? "";
          if (!rawPayload) {
            res.writeHead(400);
            res.end("Missing transloadit payload");
            return;
          }
          payload = JSON.parse(rawPayload) as WebhookPayload;
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(body.toString("utf8"));
          rawPayload = params.get("transloadit") ?? "";
          signature = params.get("signature") ?? "";
          if (!rawPayload) {
            res.writeHead(400);
            res.end("Missing transloadit payload");
            return;
          }
          payload = JSON.parse(rawPayload) as WebhookPayload;
        } else {
          rawPayload = body.toString("utf8");
          payload = JSON.parse(rawPayload) as WebhookPayload;
          signature = (
            req.headers["x-transloadit-signature"] ||
            req.headers["x-signature"] ||
            req.headers["transloadit-signature"] ||
            ""
          ).toString();
          const payloadRecord = payload as Record<string, unknown>;
          const nestedPayload = payloadRecord.transloadit;
          if (typeof nestedPayload === "string") {
            rawPayload = nestedPayload;
            payload = JSON.parse(rawPayload) as WebhookPayload;
          }
          const nestedSignature = payloadRecord.signature;
          if (typeof nestedSignature === "string") {
            signature = nestedSignature;
          }
        }

        if (!payload) {
          res.writeHead(400);
          res.end("Missing payload");
          return;
        }

        try {
          assemblyStatusSchema.parse(payload);
          await runAction("handleWebhook", {
            payload,
            rawBody: rawPayload,
            signature,
            verifySignature: true,
          });
          webhookCount += 1;
          lastWebhookPayload = payload;
        } catch (error) {
          lastWebhookError = error;
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
      server?.listen(0, () => resolvePromise());
    });

    const address = server?.address() as AddressInfo;
    serverUrl = `http://localhost:${address.port}`;

    if (useRemote) {
      if (remoteNotifyUrl) {
        notifyUrl = remoteNotifyUrl;
      } else {
        const match = /https:\/\/([a-z0-9-]+)\.convex\.cloud/i.exec(remoteUrl);
        if (!match?.[1]) {
          throw new Error("Unable to derive notifyUrl from E2E_REMOTE_URL");
        }
        notifyUrl = `https://${match[1]}.convex.site/transloadit/webhook`;
      }
    } else {
      const tunnel = await startTunnel(address.port);
      tunnelProcess = tunnel.process;
      notifyUrl =
        tunnel.info.notifyUrl ?? `${tunnel.info.url}/transloadit/webhook`;
    }

    if (appVariant === "example" && !templateId) {
      throw new Error("Missing templateId for example e2e app");
    }

    const aliases: Record<string, string> = {
      "convex/react": convexStubPath,
    };
    aliases[exampleApiPath] = apiStubPath;

    const define: Record<string, string> = {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": "{}",
    };

    if (appVariant === "example") {
      define["import.meta.env.VITE_TRANSLOADIT_TEMPLATE_ID"] =
        JSON.stringify(templateId);
      define["import.meta.env.VITE_TRANSLOADIT_NOTIFY_URL"] =
        JSON.stringify(notifyUrl);
    }

    await build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "esm",
      platform: "browser",
      outfile: bundlePath,
      logLevel: "silent",
      define,
      plugins: [aliasPlugin(aliases)],
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolvePromise) =>
        server?.close(() => resolvePromise(null)),
      );
      server = null;
    }

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
  });

  test("uploads and receives resized webhook payload", async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMessages: string[] = [];
    const requestFailures: string[] = [];
    const requestLog: string[] = [];

    page.on("console", (message) => {
      consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      consoleMessages.push(`[pageerror] ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (url.includes("transloadit") || url.includes("resumable")) {
        requestFailures.push(`${url} ${request.failure()?.errorText ?? ""}`);
      }
    });
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("transloadit") || url.includes("resumable")) {
        requestLog.push(
          `${new Date().toISOString()} ${request.method()} ${url}`,
        );
      }
    });

    try {
      await page.goto(serverUrl, { waitUntil: "domcontentloaded" });

      const tempDir = await mkdtemp(join(tmpdir(), "transloadit-e2e-"));
      const imagePath = join(tempDir, "sample.png");
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
      await writeFile(imagePath, Buffer.from(pngBase64, "base64"));

      await page.setInputFiles('[data-testid="file-input"]', imagePath);

      const readText = async (selector: string) => {
        const element = await page.$(selector);
        if (!element) return null;
        const text = await element.textContent();
        return text ?? null;
      };

      const waitForOutcome = async () => {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const assemblyText = await readText('[data-testid="assembly-id"]');
          if (assemblyText) {
            return { type: "assembly", text: assemblyText };
          }

          const uploadError = await readText('[data-testid="upload-error"]');
          if (uploadError) {
            return { type: "error", text: uploadError };
          }

          const configError = await readText('[data-testid="config-error"]');
          if (configError) {
            return { type: "config", text: configError };
          }

          await page.waitForTimeout(1000);
        }

        return null;
      };

      const outcome = await waitForOutcome();
      if (!outcome) {
        throw new Error("Timed out waiting for upload outcome");
      }
      if (outcome.type !== "assembly") {
        throw new Error(`Upload failed: ${outcome.text}`);
      }

      const assemblyText = outcome.text;
      const assemblyId = assemblyText?.replace("ID:", "").trim() ?? "";
      expect(assemblyId).not.toBe("");

      const waitForUploadCompletion = async () => {
        const start = Date.now();
        const deadline = start + 120_000;
        let sawProgress = false;
        while (Date.now() < deadline) {
          const uploadError = await readText('[data-testid="upload-error"]');
          if (uploadError) {
            throw new Error(`Upload failed: ${uploadError}`);
          }

          const progress = await page.$('[data-testid="upload-progress"]');
          if (progress) {
            sawProgress = true;
          } else if (sawProgress) {
            return;
          } else if (Date.now() - start > 10_000) {
            return;
          }

          await page.waitForTimeout(1000);
        }

        if (sawProgress) {
          throw new Error("Upload did not complete within 120s");
        }
      };

      await waitForUploadCompletion();

      const waitForResults = async (timeoutMs: number) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const results = await runQuery("listResults", { assemblyId });
          if (results.length > 0) {
            return results;
          }
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 1500),
          );
        }
        return [];
      };

      let results = await waitForResults(60_000);
      if (!results.length) {
        console.log("Webhook count:", webhookCount);
        console.log("Last webhook payload:", lastWebhookPayload);
        console.log("Last webhook error:", lastWebhookError);

        const waitForAssembly = async () => {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            const refreshArgs =
              !useRemote && authKey && authSecret
                ? { assemblyId, config: { authKey, authSecret } }
                : { assemblyId };
            const refresh = await runAction("refreshAssembly", refreshArgs);

            const ok = typeof refresh.ok === "string" ? refresh.ok : "";
            if (ok === "ASSEMBLY_COMPLETED") {
              return refresh;
            }
            if (
              ok &&
              ok !== "ASSEMBLY_EXECUTING" &&
              ok !== "ASSEMBLY_UPLOADING"
            ) {
              throw new Error(`Assembly failed with status ${ok}`);
            }

            await new Promise((resolvePromise) =>
              setTimeout(resolvePromise, 3000),
            );
          }
          return null;
        };

        await waitForAssembly();

        results = await waitForResults(60_000);
      }

      const resized = Array.isArray(results)
        ? results.find((result) => result?.stepName === "resize")
        : null;

      expect(resized).toBeTruthy();
      expect(typeof resized.sslUrl).toBe("string");
      expect(resized.sslUrl).toMatch(/^https:\/\//);

      const storedStatus = await runQuery("getAssemblyStatus", {
        assemblyId,
      });
      expect(storedStatus?.ok).toBe("ASSEMBLY_COMPLETED");
    } catch (error) {
      if (consoleMessages.length) {
        console.log("Browser console logs:", consoleMessages);
      }
      if (requestFailures.length) {
        console.log("Browser request failures:", requestFailures);
      }
      if (requestLog.length) {
        const tail = requestLog.slice(-200);
        console.log("Browser request log (last 200):", tail);
      }
      throw error;
    } finally {
      await browser.close();
    }
  });
});
