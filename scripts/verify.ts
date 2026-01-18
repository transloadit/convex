import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.ts";
import { writeAppFiles } from "./qa/app-template.ts";
import { parseDeployOutput, requireEnv, run } from "./qa/run.ts";

loadEnv();

type Mode = "local" | "cloud";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
    deploymentUrl: string;
    notifyUrl: string;
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
    testEnv.E2E_REMOTE_URL = options.remote.deploymentUrl;
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
const runMain = async () => {
  if (resolvedMode === "cloud") {
    const remote = await setupRemoteDeployment();
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
