import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { api } from "../../src/component/_generated/api.js";
import schema from "../../src/component/schema.js";
import { modules } from "../../src/component/setup.test.js";

const authKey =
  process.env.TRANSLOADIT_KEY ?? process.env.TRANSLOADIT_AUTH_KEY ?? "";
const authSecret =
  process.env.TRANSLOADIT_SECRET ?? process.env.TRANSLOADIT_AUTH_SECRET ?? "";

const fixturesDir = resolve("test/e2e/fixtures");
const distDir = resolve("dist");

const describeE2e = authKey && authSecret ? describe : describe.skip;

type TunnelInfo = {
  url: string;
  notifyUrl?: string;
};

type WebhookPayload = {
  ok?: string;
  assembly_id?: string;
  [key: string]: unknown;
};

function splitBuffer(buffer: Buffer, delimiter: Buffer) {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function parseMultipart(buffer: Buffer, contentType: string) {
  const match = /boundary=(.+)$/i.exec(contentType || "");
  if (!match) {
    throw new Error("Missing multipart boundary");
  }
  const boundary = match[1].replace(/^"|"$/g, "");
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, delimiter);
  const fields: Record<string, string> = {};

  for (const part of parts) {
    if (part.length === 0) continue;
    if (part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) {
      continue;
    }

    const trimmed = part.slice(part.indexOf("\r\n") + 2);
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = trimmed.slice(0, headerEnd).toString("utf8");
    const content = trimmed.slice(headerEnd + 4);
    const contentTrimmed = content.slice(0, content.length - 2);

    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    fields[name] = contentTrimmed.toString("utf8");
  }

  return fields;
}

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function startTunnel(port: number) {
  const process = spawn(
    "node",
    [resolve("scripts/start-webhook-tunnel.ts"), "--json", "--port", `${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const info = await new Promise<TunnelInfo>((resolvePromise, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) return;
        try {
          resolvePromise(JSON.parse(line) as TunnelInfo);
        } catch (error) {
          reject(error);
        }
      }
    };

    process.stdout?.on("data", onData);
    process.stderr?.on("data", onData);
    process.on("error", (error) => reject(error));
  });

  return { process, info };
}

function contentTypeFor(pathname: string) {
  const extension = extname(pathname);
  if (extension === ".html") return "text/html";
  if (extension === ".js") return "text/javascript";
  if (extension === ".map" || extension === ".json") return "application/json";
  return "application/octet-stream";
}

describeE2e("e2e upload flow", () => {
  let serverUrl = "";
  let notifyUrl = "";
  let tunnelProcess: ReturnType<typeof spawn> | null = null;
  let server: ReturnType<typeof createServer> | null = null;

  const t = convexTest(schema, modules);

  beforeAll(async () => {
    const distEntry = join(distDir, "react", "index.js");
    if (!existsSync(distEntry)) {
      throw new Error(
        "Missing dist artifacts. Run `yarn build` before running e2e tests.",
      );
    }

    const indexTemplate = await readFile(
      join(fixturesDir, "index.html"),
      "utf8",
    );
    const appScript = await readFile(join(fixturesDir, "app.js"));
    const convexStub = await readFile(
      join(fixturesDir, "convex-react-stub.js"),
    );

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
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(appScript);
        return;
      }

      if (
        method === "GET" &&
        url.pathname === "/fixtures/convex-react-stub.js"
      ) {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(convexStub);
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/dist/")) {
        const relativePath = url.pathname.replace("/dist/", "");
        const filePath = join(distDir, relativePath);
        if (!filePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end();
          return;
        }
        try {
          const file = await readFile(filePath);
          res.writeHead(200, { "content-type": contentTypeFor(filePath) });
          res.end(file);
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/action") {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body.toString("utf8")) as {
          name?: string;
          args?: Record<string, unknown>;
        };

        if (payload.name !== "generateUploadParams") {
          res.writeHead(404);
          res.end("Unknown action");
          return;
        }

        const args = payload.args ?? {};
        const actionResult = await t.action(api.lib.generateUploadParams, {
          config: {
            authKey,
            authSecret,
          },
          steps,
          notifyUrl:
            typeof args.notifyUrl === "string" ? args.notifyUrl : notifyUrl,
          numExpectedUploadFiles: 1,
          fields: args.fields,
          expires: args.expires,
          additionalParams: args.additionalParams,
          userId: args.userId,
        });

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
          const result = await t.query(api.lib.getAssemblyStatus, {
            assemblyId,
          });
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
          const result = await t.query(api.lib.listResults, {
            assemblyId,
          });
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

        await t.action(api.lib.handleWebhook, {
          payload,
          rawBody: rawPayload,
          signature,
          verifySignature: true,
        });

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

    const tunnel = await startTunnel(address.port);
    tunnelProcess = tunnel.process;
    notifyUrl =
      tunnel.info.notifyUrl ?? `${tunnel.info.url}/transloadit/webhook`;
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

    await page.goto(serverUrl, { waitUntil: "domcontentloaded" });

    const tempDir = await mkdtemp(join(tmpdir(), "transloadit-e2e-"));
    const imagePath = join(tempDir, "sample.png");
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAB7GkOtAAAADUlEQVR4nGP4z8DwHwAF7gL+5K9I5QAAAABJRU5ErkJggg==";
    await writeFile(imagePath, Buffer.from(pngBase64, "base64"));

    await page.setInputFiles('[data-testid="file-input"]', imagePath);

    await page.waitForSelector('[data-testid="assembly-id"]', {
      timeout: 120_000,
    });

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="results-json"]');
        return el?.textContent && el.textContent.length > 0;
      },
      { timeout: 180_000 },
    );

    const resultsText = await page.textContent('[data-testid="results-json"]');
    const results = resultsText ? JSON.parse(resultsText) : [];

    const resized = Array.isArray(results)
      ? results.find((result) => result?.stepName === "resize")
      : null;

    expect(resized).toBeTruthy();
    expect(typeof resized.sslUrl).toBe("string");
    expect(resized.sslUrl).toMatch(/^https:\/\//);

    const statusText = await page.textContent(
      '[data-testid="assembly-status"]',
    );
    expect(statusText).toContain("ASSEMBLY_COMPLETED");

    await browser.close();
  });
});
