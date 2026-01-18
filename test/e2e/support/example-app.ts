import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { sleep } from "./sleep.js";
import { startTunnel } from "./tunnel.js";

type ExampleAppOptions = {
  env: NodeJS.ProcessEnv;
};

type ExampleApp = {
  url: string;
  notifyUrl: string;
  close: () => Promise<void>;
};

const findOpenPort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to determine a free port");
  }
  const port = address.port;
  server.close();
  return port;
};

const waitForReady = async (url: string) => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // ignore until ready
    }
    await sleep(500);
  }
  throw new Error("Next example did not start in time");
};

export const startExampleApp = async ({
  env,
}: ExampleAppOptions): Promise<ExampleApp> => {
  const port = await findOpenPort();
  const tunnel = await startTunnel(port);
  const notifyUrl =
    tunnel.info.notifyUrl ?? `${tunnel.info.url}/transloadit/webhook`;

  const nextCli = resolve("node_modules/next/dist/bin/next");
  const child = spawn(
    "node",
    [
      nextCli,
      "dev",
      "--dir",
      "example",
      "--hostname",
      "127.0.0.1",
      "--port",
      `${port}`,
    ],
    {
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        TRANSLOADIT_NOTIFY_URL: notifyUrl,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const url = `http://127.0.0.1:${port}`;
  await waitForReady(url);

  const close = async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolvePromise) => {
        const fallback = setTimeout(() => {
          child.kill("SIGKILL");
          resolvePromise(null);
        }, 3000);
        child.once("exit", () => {
          clearTimeout(fallback);
          resolvePromise(null);
        });
      });
    }

    if (tunnel.process.exitCode === null) {
      tunnel.process.kill();
      await new Promise((resolvePromise) => {
        const fallback = setTimeout(() => {
          tunnel.process.kill("SIGKILL");
          resolvePromise(null);
        }, 3000);
        tunnel.process.once("exit", () => {
          clearTimeout(fallback);
          resolvePromise(null);
        });
      });
    }
  };

  return { url, notifyUrl, close };
};
