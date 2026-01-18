import { spawnSync } from "node:child_process";

const skipInstall = process.env.PLAYWRIGHT_SKIP_INSTALL === "1";

const parseArgs = (args: string[]) => {
  const options: { app?: string; useTemplate?: boolean } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--app") {
      options.app = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--use-template") {
      options.useTemplate = true;
    }
  }
  return options;
};

const cliOptions = parseArgs(process.argv.slice(2));
const appVariant =
  cliOptions.app ??
  process.env.E2E_APP ??
  process.env.TRANSLOADIT_E2E_APP ??
  "fixture";
const useTemplate =
  cliOptions.useTemplate ??
  (process.env.E2E_USE_TEMPLATE === "1" || appVariant === "example");

const run = (
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" },
) => {
  const result = spawnSync(command, args, {
    stdio: options?.stdio ?? "inherit",
    env: options?.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout;
    if (message) {
      process.stderr.write(message);
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
};

if (!skipInstall) {
  run("yarn", ["exec", "playwright", "install", "chromium"]);
}

let templateInfo: { templateId: string } | null = null;
if (useTemplate) {
  console.log("Ensuring template...");
  const templateOutput = run("node", ["scripts/ensure-template.ts"], {
    stdio: "pipe",
    env: process.env,
  });

  const parseJson = <T>(output: string): T => {
    const trimmed = output.trim();
    if (!trimmed) {
      throw new Error("Template preflight returned empty output");
    }
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as T;
    }
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(`Unable to parse JSON from output: ${trimmed}`);
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  };

  templateInfo = parseJson<{ templateId: string }>(templateOutput);
}

run("yarn", ["build"]);

const testEnv: NodeJS.ProcessEnv = {
  ...process.env,
  E2E_APP: appVariant,
  E2E_USE_TEMPLATE: useTemplate ? "1" : "0",
};

if (useTemplate) {
  if (!templateInfo?.templateId) {
    throw new Error("Missing templateId for browser test");
  }
  testEnv.TRANSLOADIT_TEMPLATE_ID = templateInfo.templateId;
}

run("yarn", ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts"], {
  env: testEnv,
});
