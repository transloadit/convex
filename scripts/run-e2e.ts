import { spawnSync } from "node:child_process";

const skipInstall = process.env.PLAYWRIGHT_SKIP_INSTALL === "1";

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!skipInstall) {
  run("yarn", ["exec", "playwright", "install", "chromium"]);
}

run("yarn", ["build"]);

run("yarn", ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts"]);
