import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.ts";
import { writeAppFiles } from "./qa/app-template.ts";
import { parseDeployOutput, requireEnv, run } from "./qa/run.ts";

loadEnv();

const ciOutput = process.env.CI_OUTPUT === "1";
const log = (...args: Parameters<typeof console.log>) => {
  if (ciOutput) {
    console.error(...args);
  } else {
    console.log(...args);
  }
};

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

    log(`Packing @transloadit/convex into ${tgzPath}...`);
    run("yarn", ["pack", "-o", tgzPath], { cwd: rootDir });

    await writeAppFiles({ projectDir, tgzPath });

    log("Installing dependencies...");
    run("npm", ["install", "--no-fund", "--no-audit"], { cwd: projectDir });

    log("Deploying Convex app...");
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
    log(`Deployment URL: ${deploymentUrl}`);
    log(`Webhook URL: ${notifyUrl}`);

    log("Setting env vars on deployment...");
    const deployEnv = {
      ...process.env,
      CONVEX_DEPLOY_KEY: requireEnv("CONVEX_DEPLOY_KEY"),
    };
    const setEnv = (name: string, value: string) => {
      run("npx", ["convex", "env", "set", name, value], {
        cwd: projectDir,
        env: deployEnv,
      });
    };

    setEnv("TRANSLOADIT_KEY", requireEnv("TRANSLOADIT_KEY"));
    setEnv("TRANSLOADIT_SECRET", requireEnv("TRANSLOADIT_SECRET"));
    setEnv("TRANSLOADIT_NOTIFY_URL", notifyUrl);

    const optionalEnv = [
      "TRANSLOADIT_R2_CREDENTIALS",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCOUNT_ID",
      "R2_HOST",
      "R2_PUBLIC_URL",
    ];

    for (const name of optionalEnv) {
      const value = process.env[name];
      if (value) {
        setEnv(name, value);
      }
    }

    if (ciOutput) {
      process.stdout.write(`E2E_REMOTE_CONVEX_URL=${deploymentUrl}\n`);
      process.stdout.write(`TRANSLOADIT_NOTIFY_URL=${notifyUrl}\n`);
    }
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
