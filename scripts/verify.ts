import { loadEnv } from "./env.ts";
import { run } from "./qa/run.ts";

loadEnv();

type Mode = "local" | "cloud";

const parseArgs = (args: string[]) => {
  let mode: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      mode = args[index + 1];
      index += 1;
    }
  }

  return { mode };
};

const runBrowser = async (options: {
  mode: Mode;
  remote?: {
    appUrl: string;
  };
}) => {
  const skipInstall = process.env.PLAYWRIGHT_SKIP_INSTALL === "1";

  if (!skipInstall) {
    run("yarn", ["exec", "playwright", "install", "chromium"]);
  }

  run("yarn", ["build"]);

  const testEnv: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_MODE: options.mode,
  };

  if (options.remote) {
    testEnv.E2E_REMOTE_APP_URL = options.remote.appUrl;
  }

  run("yarn", ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts"], {
    env: testEnv,
  });
};

const resolveCloudConfig = () => {
  const appUrl =
    process.env.E2E_REMOTE_APP_URL ?? process.env.E2E_APP_URL ?? "";
  if (!appUrl) {
    throw new Error("Missing E2E_REMOTE_APP_URL");
  }
  return {
    appUrl,
  };
};

const args = parseArgs(process.argv.slice(2));
const rawMode = args.mode ?? process.env.VERIFY_MODE ?? "local";
const resolvedMode: Mode =
  rawMode === "cloud" ||
  rawMode === "preview" ||
  rawMode === "real" ||
  rawMode === "convex"
    ? "cloud"
    : "local";
const runMain = async () => {
  if (resolvedMode === "cloud") {
    const remote = resolveCloudConfig();
    await runBrowser({
      mode: "cloud",
      remote,
    });
    return;
  }

  await runBrowser({
    mode: "local",
  });
};

runMain().catch((error) => {
  console.error(error);
  process.exit(1);
});
