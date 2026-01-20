import { createPublicKey, generateKeyPairSync } from "node:crypto";
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
const runStdio = ciOutput ? "pipe" : "inherit";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
    run("yarn", ["pack", "-o", tgzPath], { cwd: rootDir, stdio: runStdio });

    await writeAppFiles({ projectDir, tgzPath });

    log("Installing dependencies...");
    run("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: projectDir,
      stdio: runStdio,
    });

    log("Deploying Convex app...");
    const deployOutput = run(
      "npx",
      ["convex", "deploy", "--typecheck", "disable", "--yes"],
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
    const siteUrl = `https://${deploymentName}.convex.site`;
    const notifyUrl = `${siteUrl}/transloadit/webhook`;
    log(`Deployment URL: ${deploymentUrl}`);
    log(`Webhook URL: ${notifyUrl}`);

    log("Waiting for deployment to accept env updates...");
    await sleep(5000);

    log("Setting env vars on deployment...");
    const deployEnv = {
      ...process.env,
      CONVEX_DEPLOY_KEY: requireEnv("CONVEX_DEPLOY_KEY"),
    };
    const setEnv = async (name: string, value: string) => {
      const attempts = 3;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          run(
            "npx",
            ["convex", "env", "set", "--deployment-name", deploymentName, name],
            {
              cwd: projectDir,
              env: deployEnv,
              stdio: runStdio === "inherit" ? "pipe" : runStdio,
              input: value,
            },
          );
          return;
        } catch (error) {
          if (attempt === attempts) {
            throw error;
          }
          log(
            `Failed to set ${name} (attempt ${attempt}/${attempts}). Retrying...`,
          );
          await sleep(5000 * attempt);
        }
      }
    };

    await setEnv("TRANSLOADIT_KEY", requireEnv("TRANSLOADIT_KEY"));
    await setEnv("TRANSLOADIT_SECRET", requireEnv("TRANSLOADIT_SECRET"));
    await setEnv("TRANSLOADIT_NOTIFY_URL", notifyUrl);
    await setEnv("CONVEX_SITE_URL", siteUrl);
    let jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
    if (!jwtPrivateKey) {
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      jwtPrivateKey = privateKey;
    }
    await setEnv("JWT_PRIVATE_KEY", jwtPrivateKey);
    const jwk = createPublicKey(jwtPrivateKey).export({ format: "jwk" });
    const jwks = JSON.stringify({
      keys: [
        {
          ...jwk,
          use: "sig",
          alg: "RS256",
          kid: "convex",
        },
      ],
    });
    await setEnv("JWKS", jwks);

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
        await setEnv(name, value);
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
