import { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import { api } from "../../../src/component/_generated/api.js";
import schema from "../../../src/component/schema.js";
import { modules } from "../../../src/component/setup.test.js";

type ConvexRunnerOptions = {
  useRemote: boolean;
  remoteUrl: string;
  remoteAdminKey: string;
  authKey: string;
  authSecret: string;
};

export type ConvexRunner = {
  connect: () => void;
  runAction: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  runQuery: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

export const createConvexRunner = ({
  useRemote,
  remoteUrl,
  remoteAdminKey,
  authKey,
  authSecret,
}: ConvexRunnerOptions): ConvexRunner => {
  const t = useRemote ? null : convexTest(schema, modules);
  let remoteClient: ConvexHttpClient | null = null;

  const connect = () => {
    if (!useRemote) return;
    if (!remoteUrl || !remoteAdminKey) {
      throw new Error(
        "Missing E2E_REMOTE_URL or E2E_REMOTE_ADMIN_KEY for cloud mode",
      );
    }
    remoteClient = new ConvexHttpClient(remoteUrl, { logger: false });
    remoteClient.setAdminAuth(remoteAdminKey);
    remoteClient.setDebug(false);
  };

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

  return { connect, runAction, runQuery };
};
