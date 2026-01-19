import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.ts";
import { writeAppFiles } from "./qa/app-template.ts";
import { parseDeployOutput, requireEnv, run } from "./qa/run.ts";

loadEnv();

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

const deployCloud = async () => {
  requireEnv("TRANSLOADIT_KEY");
  requireEnv("TRANSLOADIT_SECRET");
  requireEnv("CONVEX_DEPLOY_KEY");

  let qaDir: string | null = null;

  try {
    qaDir = await mkdtemp(join(tmpdir(), "transloadit-convex-deploy-"));
    const projectDir = join(qaDir, "app");
    const tgzPath = join(qaDir, "transloadit-convex.tgz");

    await mkdir(projectDir, { recursive: true });

    console.log(`Packing @transloadit/convex into ${tgzPath}...`);
    run("yarn", ["pack", "-o", tgzPath], { cwd: rootDir });

    await writeAppFiles({ projectDir, tgzPath });

    console.log("Installing dependencies...");
    run("npm", ["install", "--no-fund", "--no-audit"], { cwd: projectDir });

    console.log("Deploying Convex app...");
    const deployOutput = run(
      "npx",
      [
        "convex",
        "deploy",
        "--codegen",
        "disable",
        "--typecheck",
        "disable",
        "--yes",
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
    console.log(`Deployment URL: ${deploymentUrl}`);
    console.log(`Webhook URL: ${notifyUrl}`);

    console.log("Setting env vars on deployment...");
    run(
      "npx",
      [
        "convex",
        "env",
        "set",
        "TRANSLOADIT_KEY",
        requireEnv("TRANSLOADIT_KEY"),
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
      ],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CONVEX_DEPLOY_KEY: requireEnv("CONVEX_DEPLOY_KEY"),
        },
      },
    );
  } finally {
    if (qaDir) {
      await rm(qaDir, { recursive: true, force: true });
    }
  }
};

deployCloud().catch((error) => {
  console.error(error);
  process.exit(1);
});
