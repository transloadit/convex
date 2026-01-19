import { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import { api } from "../../src/component/_generated/api.ts";
import schema from "../../src/component/schema.ts";
import { modules } from "../../src/test/nodeModules.ts";
import { buildWeddingSteps } from "./transloadit-steps";

type Mode = "local" | "cloud";

const authKey = process.env.TRANSLOADIT_KEY ?? "";
const authSecret = process.env.TRANSLOADIT_SECRET ?? "";
const remoteUrl = process.env.E2E_REMOTE_URL ?? process.env.CONVEX_URL ?? "";
const remoteAdminKey =
  process.env.E2E_REMOTE_ADMIN_KEY ?? process.env.CONVEX_ADMIN_KEY ?? "";

const resolveMode = (): Mode => {
  const explicit = process.env.E2E_MODE;
  if (explicit === "cloud") return "cloud";
  if (explicit === "local") return "local";
  if (remoteUrl && remoteAdminKey) return "cloud";
  return "local";
};

const mode = resolveMode();
const testClient = mode === "local" ? convexTest(schema, modules) : null;
const remoteClient =
  mode === "cloud" && remoteUrl && remoteAdminKey
    ? new ConvexHttpClient(remoteUrl, { logger: false })
    : null;

if (remoteClient) {
  remoteClient.setAdminAuth(remoteAdminKey);
  remoteClient.setDebug(false);
}

export const runAction = async (
  name: string,
  args: Record<string, unknown>,
) => {
  if (remoteClient) {
    const remoteName =
      name === "createWeddingAssembly"
        ? "wedding:createWeddingAssembly"
        : `transloadit:${name}`;
    return remoteClient.action(remoteName, args);
  }

  if (mode === "cloud") {
    throw new Error("Missing E2E_REMOTE_URL or E2E_REMOTE_ADMIN_KEY");
  }

  if (!testClient) {
    throw new Error("Missing Convex test harness");
  }

  const config = authKey && authSecret ? { authKey, authSecret } : undefined;

  if (name === "createWeddingAssembly") {
    const notifyUrl = process.env.TRANSLOADIT_NOTIFY_URL;
    if (!notifyUrl) {
      throw new Error("Missing TRANSLOADIT_NOTIFY_URL");
    }
    const fileCount =
      typeof args.fileCount === "number" ? Math.max(1, args.fileCount) : 1;
    const guestName =
      typeof args.guestName === "string" ? args.guestName : "Guest";

    return testClient.action(api.lib.createAssembly, {
      steps: buildWeddingSteps(),
      notifyUrl,
      numExpectedUploadFiles: fileCount,
      fields: {
        guestName,
        album: "wedding-gallery",
        fileCount,
      },
      config,
    });
  }

  if (name === "createAssembly") {
    return testClient.action(api.lib.createAssembly, { ...args, config });
  }
  if (name === "handleWebhook") {
    return testClient.action(api.lib.handleWebhook, {
      ...args,
      config: config ? { authSecret: config.authSecret } : undefined,
      verifySignature: true,
    });
  }
  if (name === "queueWebhook") {
    // Local harness does not run scheduled jobs, so process immediately.
    return testClient.action(api.lib.handleWebhook, {
      ...args,
      config: config ? { authSecret: config.authSecret } : undefined,
    });
  }
  if (name === "refreshAssembly") {
    return testClient.action(api.lib.refreshAssembly, { ...args, config });
  }

  throw new Error(`Unknown action ${name}`);
};

export const runQuery = async (name: string, args: Record<string, unknown>) => {
  if (remoteClient) {
    return remoteClient.query(`transloadit:${name}`, args);
  }

  if (mode === "cloud") {
    throw new Error("Missing E2E_REMOTE_URL or E2E_REMOTE_ADMIN_KEY");
  }

  if (!testClient) {
    throw new Error("Missing Convex test harness");
  }

  if (name === "getAssemblyStatus") {
    return testClient.query(api.lib.getAssemblyStatus, {
      assemblyId: args.assemblyId as string,
    });
  }
  if (name === "listResults") {
    return testClient.query(api.lib.listResults, args);
  }

  throw new Error(`Unknown query ${name}`);
};
