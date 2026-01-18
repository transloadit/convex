import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { writeAppFiles } from "./qa/app-template.js";

config({ path: process.env.DOTENV_CONFIG_PATH });

type Mode = "local" | "cloud";

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
};

const run = (command: string, args: string[], options: RunOptions = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${output}`);
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const parseArgs = (args: string[]) => {
  let mode: string | undefined;
  let app: string | undefined;
  let useTemplate = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      mode = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--app") {
      app = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--use-template") {
      useTemplate = true;
    }
  }

  return { mode, app, useTemplate };
};

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

const runBrowser = async (options: {
  appVariant: "fixture" | "example";
  useTemplate: boolean;
  mode: Mode;
  remote?: {
    deploymentUrl: string;
    notifyUrl: string;
  };
}) => {
  const skipInstall = process.env.PLAYWRIGHT_SKIP_INSTALL === "1";

  if (!skipInstall) {
    run("yarn", ["exec", "playwright", "install", "chromium"]);
  }

  let templateInfo: { templateId: string } | null = null;
  if (options.useTemplate) {
    console.log("Ensuring template...");
    const templateOutput = run("node", ["scripts/ensure-template.ts"], {
      stdio: "pipe",
      env: process.env,
    });
    templateInfo = parseJson<{ templateId: string }>(templateOutput);
  }

  run("yarn", ["build"]);

  const testEnv: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_APP: options.appVariant,
    E2E_USE_TEMPLATE: options.useTemplate ? "1" : "0",
    E2E_MODE: options.mode,
  };

  if (options.useTemplate) {
    if (!templateInfo?.templateId) {
      throw new Error("Missing templateId for browser test");
    }
    testEnv.TRANSLOADIT_TEMPLATE_ID = templateInfo.templateId;
  }

  if (options.remote) {
    testEnv.E2E_REMOTE_URL = options.remote.deploymentUrl;
    testEnv.E2E_REMOTE_NOTIFY_URL = options.remote.notifyUrl;
    testEnv.E2E_REMOTE_ADMIN_KEY = requireEnv("CONVEX_DEPLOY_KEY");
  }

  run("yarn", ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts"], {
    env: testEnv,
  });
};

const toPreviewName = () => {
  const explicit = process.env.CONVEX_PREVIEW_NAME;
  if (explicit) return explicit;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `transloadit-qa-${Date.now().toString(36)}-${suffix}`;
};

const parseDeployOutput = (output: string) => {
  const cloudMatch = /https:\/\/([a-z0-9-]+)\.convex\.cloud/i.exec(output);
  if (cloudMatch?.[1]) {
    return {
      deploymentName: cloudMatch[1],
      deploymentUrl: `https://${cloudMatch[1]}.convex.cloud`,
    };
  }

  const siteMatch = /https:\/\/([a-z0-9-]+)\.convex\.site/i.exec(output);
  if (siteMatch?.[1]) {
    return {
      deploymentName: siteMatch[1],
      deploymentUrl: `https://${siteMatch[1]}.convex.cloud`,
    };
  }

  throw new Error(`Unable to find deployment URL in output:\n${output}`);
};

const setupRemoteDeployment = async () => {
  requireEnv("TRANSLOADIT_KEY");
  requireEnv("TRANSLOADIT_SECRET");
  requireEnv("CONVEX_DEPLOY_KEY");

  const previewName = toPreviewName();
  let qaDir: string | null = null;

  try {
    qaDir = await mkdtemp(join(tmpdir(), "transloadit-convex-qa-"));
    const projectDir = join(qaDir, "app");
    const tgzPath = join(qaDir, "transloadit-convex.tgz");

    await mkdir(projectDir, { recursive: true });

    console.log(`Packing @transloadit/convex into ${tgzPath}...`);
    run("yarn", ["pack", "-o", tgzPath], { cwd: rootDir });

    await writeAppFiles({ projectDir, tgzPath });

    console.log("Installing dependencies...");
    run("npm", ["install", "--no-fund", "--no-audit"], { cwd: projectDir });

    console.log(`Deploying preview ${previewName}...`);
    const deployOutput = run(
      "npx",
      [
        "convex",
        "deploy",
        "--preview-create",
        previewName,
        "--codegen",
        "disable",
        "--typecheck",
        "disable",
      ],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CONVEX_DEPLOY_KEY: requireEnv("CONVEX_DEPLOY_KEY"),
        },
        stdio: "pipe",
      },
    );

    const { deploymentName, deploymentUrl } = parseDeployOutput(deployOutput);
    const notifyUrl = `https://${deploymentName}.convex.site/transloadit/webhook`;

    console.log("Setting env vars on preview deployment...");
    run(
      "npx",
      [
        "convex",
        "env",
        "set",
        "TRANSLOADIT_KEY",
        requireEnv("TRANSLOADIT_KEY"),
        "--preview-name",
        previewName,
      ],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CONVEX_DEPLOY_KEY: requireEnv("CONVEX_DEPLOY_KEY"),
        },
      },
    );
    run(
      "npx",
      [
        "convex",
        "env",
        "set",
        "TRANSLOADIT_SECRET",
        requireEnv("TRANSLOADIT_SECRET"),
        "--preview-name",
        previewName,
      ],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CONVEX_DEPLOY_KEY: requireEnv("CONVEX_DEPLOY_KEY"),
        },
      },
    );

    return {
      previewName,
      deploymentName,
      deploymentUrl,
      notifyUrl,
    };
  } finally {
    if (qaDir && !process.env.QA_KEEP_TEMP) {
      await rm(qaDir, { recursive: true, force: true });
    }
  }
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
const appVariant =
  rawMode === "example" || args.app === "example" ? "example" : "fixture";
const useTemplate =
  args.useTemplate ||
  process.env.E2E_USE_TEMPLATE === "1" ||
  appVariant === "example";

const runMain = async () => {
  if (resolvedMode === "cloud") {
    const remote = await setupRemoteDeployment();
    await runBrowser({
      appVariant,
      useTemplate,
      mode: "cloud",
      remote,
    });
    return;
  }

  await runBrowser({
    appVariant,
    useTemplate,
    mode: "local",
  });
};

runMain().catch((error) => {
  console.error(error);
  process.exit(1);
});
