import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const authKey =
  process.env.TRANSLOADIT_KEY ?? process.env.TRANSLOADIT_AUTH_KEY ?? "";
const authSecret =
  process.env.TRANSLOADIT_SECRET ?? process.env.TRANSLOADIT_AUTH_SECRET ?? "";
const verbose =
  process.env.QA_VERBOSE === "1" || process.argv.includes("--verbose");

const log = (...args: unknown[]) => {
  if (verbose) {
    console.log(...args);
  }
};

type TemplateInfo = {
  templateId: string;
  templateName: string;
};

type TunnelInfo = {
  url: string;
  notifyUrl?: string;
};

type WebhookPayload = {
  ok?: string;
  assembly_id?: string;
  [key: string]: unknown;
};

if (!authKey || !authSecret) {
  throw new Error(
    "Missing TRANSLOADIT_KEY/TRANSLOADIT_SECRET (or TRANSLOADIT_AUTH_KEY/TRANSLOADIT_AUTH_SECRET)",
  );
}

function runScript(scriptPath: string) {
  const result = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (verbose) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Script failed");
  }
  return result.stdout?.trim() ?? "";
}

function parseJson<T>(output: string): T {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output but got empty string");
  }
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`Unable to parse JSON from output: ${trimmed}`);
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

log("Running build...");
const buildResult = spawnSync("yarn", ["build"], {
  encoding: "utf8",
  stdio: verbose ? "inherit" : "pipe",
});
if (buildResult.status !== 0) {
  throw new Error(buildResult.stderr || buildResult.stdout || "Build failed");
}

log("Ensuring template...");
const ensureTemplateOutput = runScript(resolve("scripts/ensure-template.ts"));
const templateInfo = parseJson<TemplateInfo>(ensureTemplateOutput);
log("Template info:", templateInfo);

const serverPort = 8790;

log("Starting webhook tunnel...");
const tunnelProcess = spawn(
  "node",
  [
    resolve("scripts/start-webhook-tunnel.ts"),
    "--json",
    "--port",
    String(serverPort),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const tunnelInfo = await new Promise<TunnelInfo>((resolvePromise, reject) => {
  let buffer = "";
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString();
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) return;
      try {
        resolvePromise(parseJson<TunnelInfo>(line));
      } catch (error) {
        reject(error);
      }
    }
  };

  tunnelProcess.stdout?.on("data", onData);
  tunnelProcess.stderr?.on("data", onData);
  tunnelProcess.on("error", (error) => reject(error));
});

log("Tunnel info:", tunnelInfo);

const componentDist = resolve("dist/component");
const schemaModule = await import(
  pathToFileURL(join(componentDist, "schema.js")).href
);
const apiModule = await import(
  pathToFileURL(join(componentDist, "_generated/api.js")).href
);
const { convexTest } = await import("convex-test");

const modules = {
  "./lib.js": () => import(pathToFileURL(join(componentDist, "lib.js")).href),
  "./apiUtils.js": () =>
    import(pathToFileURL(join(componentDist, "apiUtils.js")).href),
  "./schema.js": () =>
    import(pathToFileURL(join(componentDist, "schema.js")).href),
  "./_generated/api.js": () =>
    import(pathToFileURL(join(componentDist, "_generated/api.js")).href),
  "./_generated/dataModel.js": () =>
    import(pathToFileURL(join(componentDist, "_generated/dataModel.js")).href),
  "./_generated/server.js": () =>
    import(pathToFileURL(join(componentDist, "_generated/server.js")).href),
  "./_generated/component.js": () =>
    import(pathToFileURL(join(componentDist, "_generated/component.js")).href),
};

const t = convexTest(schemaModule.default, modules);
const { api } = apiModule;

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
    const contentTrimmed = content.slice(0, content.length - 2); // drop trailing \r\n

    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    fields[name] = contentTrimmed.toString("utf8");
  }

  return fields;
}

const webhookReceived = new Promise<WebhookPayload>((resolve, reject) => {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const body = Buffer.concat(chunks);
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
          payload = JSON.parse(rawPayload);
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(body.toString("utf8"));
          rawPayload = params.get("transloadit") ?? "";
          signature = params.get("signature") ?? "";
          if (!rawPayload) {
            res.writeHead(400);
            res.end("Missing transloadit payload");
            return;
          }
          payload = JSON.parse(rawPayload);
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
        resolve(payload);
        server.close();
      } catch (error) {
        reject(error);
        res.writeHead(500);
        res.end();
        server.close();
      }
    });
  });

  server.listen(serverPort);
});

const notifyUrlForServer = `${tunnelInfo.url}/transloadit/webhook`;
log("Notify URL:", notifyUrlForServer);

const apiUtils = await import(
  pathToFileURL(join(componentDist, "apiUtils.js")).href
);

const { buildTransloaditParams, signTransloaditParams } = apiUtils;

log("Creating assembly...");
const { paramsString } = buildTransloaditParams({
  authKey,
  steps: {
    import: {
      robot: "/http/import",
      url: "https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?auto=format&fit=crop&w=600&q=60",
      result: true,
    },
    resize: {
      use: "import",
      robot: "/image/resize",
      width: 800,
      height: 800,
      resize_strategy: "fit",
      result: true,
    },
  },
  notifyUrl: notifyUrlForServer,
});

const signature = await signTransloaditParams(paramsString, authSecret);
const formData = new FormData();
formData.append("params", paramsString);
formData.append("signature", signature);

const response = await fetch("https://api2.transloadit.com/assemblies", {
  method: "POST",
  body: formData,
});
const responseData = await response.json();
if (!response.ok) {
  throw new Error(
    `Transloadit error ${response.status}: ${JSON.stringify(responseData)}`,
  );
}

const assemblyId = responseData.assembly_id || responseData.assemblyId;
if (!assemblyId) {
  throw new Error("Transloadit response missing assembly_id");
}

let timeoutId: ReturnType<typeof setTimeout> | undefined;
const webhookTimeout = new Promise<WebhookPayload>((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error("Webhook timeout")), 120000);
});

log("Waiting for webhook...");
const webhookPayload = await Promise.race<WebhookPayload>([
  webhookReceived,
  webhookTimeout,
]);
if (timeoutId) {
  clearTimeout(timeoutId);
}
log("Webhook received:", {
  ok: webhookPayload?.ok,
  assembly_id: webhookPayload?.assembly_id,
});

const storedAssembly = await t.query(api.lib.getAssemblyStatus, {
  assemblyId,
});
const storedResults = await t.query(api.lib.listResults, { assemblyId });
log("Stored results:", {
  assemblyOk: storedAssembly?.ok,
  resultCount: storedResults.length,
});

console.log(
  JSON.stringify(
    {
      template: templateInfo,
      notifyUrl: notifyUrlForServer,
      assemblyId,
      webhookOk: webhookPayload?.ok,
      storedAssembly: storedAssembly?.ok,
      storedResults: storedResults.length,
    },
    null,
    2,
  ),
);

if (tunnelProcess.exitCode === null) {
  tunnelProcess.kill();
  await new Promise((resolve) => {
    const fallback = setTimeout(() => {
      tunnelProcess.kill("SIGKILL");
      resolve(null);
    }, 3000);
    tunnelProcess.once("exit", () => {
      clearTimeout(fallback);
      resolve(null);
    });
  });
}
