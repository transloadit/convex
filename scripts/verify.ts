import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.js";

loadEnv();

type Mode = "local" | "real";

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

const writeAppFiles = async (projectDir: string, tgzPath: string) => {
  const convexDir = join(projectDir, "convex");
  await mkdir(convexDir, { recursive: true });

  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "transloadit-convex-qa",
        private: true,
        type: "module",
        dependencies: {
          "@transloadit/convex": `file:${tgzPath}`,
          convex: "^1.31.5",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    join(convexDir, "convex.config.ts"),
    [
      'import transloadit from "@transloadit/convex/convex.config";',
      'import { defineApp } from "convex/server";',
      "",
      "const app = defineApp();",
      "app.use(transloadit);",
      "",
      "export default app;",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    join(convexDir, "transloadit.ts"),
    [
      'import { makeTransloaditAPI } from "@transloadit/convex";',
      'import { componentsGeneric } from "convex/server";',
      "",
      "const components = componentsGeneric();",
      "",
      "export const {",
      "  createAssembly,",
      "  handleWebhook,",
      "  queueWebhook,",
      "  refreshAssembly,",
      "  getAssemblyStatus,",
      "  listAssemblies,",
      "  listResults,",
      "  storeAssemblyMetadata,",
      "} = makeTransloaditAPI(components.transloadit);",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    join(convexDir, "http.ts"),
    [
      'import { parseTransloaditWebhook } from "@transloadit/convex";',
      'import { httpRouter, httpActionGeneric } from "convex/server";',
      'import { queueWebhook } from "./transloadit";',
      "",
      "const http = httpRouter();",
      "const httpAction = httpActionGeneric;",
      "",
      "http.route({",
      '  path: "/transloadit/webhook",',
      '  method: "POST",',
      "  handler: httpAction(async (ctx, request) => {",
      "    const { payload, rawBody, signature } =",
      "      await parseTransloaditWebhook(request);",
      "",
      "    await ctx.runAction(queueWebhook, {",
      "      payload,",
      "      rawBody,",
      "      signature,",
      "    });",
      "",
      "    return new Response(null, { status: 202 });",
      "  }),",
      "});",
      "",
      "export default http;",
      "",
    ].join("\n"),
    "utf8",
  );
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

    await writeAppFiles(projectDir, tgzPath);

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
  rawMode === "real" || rawMode === "convex" ? "real" : "local";
const appVariant =
  rawMode === "example" || args.app === "example" ? "example" : "fixture";
const useTemplate =
  args.useTemplate ||
  process.env.E2E_USE_TEMPLATE === "1" ||
  appVariant === "example";

const runMain = async () => {
  if (resolvedMode === "real") {
    const remote = await setupRemoteDeployment();
    await runBrowser({
      appVariant,
      useTemplate,
      mode: "real",
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
