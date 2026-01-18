import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssemblyInstructionsInput } from "@transloadit/types/template";
import { Upload } from "tus-js-client";
import { loadEnv } from "./load-env.js";

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
};

type AssemblyResponse = {
  assemblyId: string;
  data?: {
    tus_url?: string;
    assembly_ssl_url?: string;
    assembly_url?: string;
  };
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

loadEnv();

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

const sleep = (ms: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const toPreviewName = () => {
  const explicit = process.env.CONVEX_PREVIEW_NAME;
  if (explicit) return explicit;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `transloadit-qa-${Date.now().toString(36)}-${suffix}`;
};

const parseDeployOutput = (output: string) => {
  const match =
    /https:\/\/([a-z0-9-]+)\.convex\.cloud/i.exec(output) ??
    /https:\/\/([a-z0-9-]+)\.convex\.site/i.exec(output);
  if (!match) {
    throw new Error(`Unable to find deployment URL in output:\n${output}`);
  }
  return match[1];
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

const convexRun = (
  projectDir: string,
  previewName: string,
  fn: string,
  args?: unknown,
) => {
  const output = run(
    "npx",
    [
      "convex",
      "run",
      fn,
      args ? JSON.stringify(args) : "{}",
      "--preview-name",
      previewName,
      "--typecheck",
      "disable",
      "--codegen",
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
  ).trim();

  return output ? (JSON.parse(output) as unknown) : null;
};

const runUpload = async (
  tusUrl: string,
  assemblyUrl: string,
  filePath: string,
) => {
  const upload = new Upload(createReadStream(filePath), {
    endpoint: tusUrl,
    chunkSize: 1024 * 256,
    metadata: {
      filename: "sample.png",
      filetype: "image/png",
      fieldname: "file",
      assembly_url: assemblyUrl,
    },
    onError: (error) => {
      throw error;
    },
  });

  await new Promise<void>((resolvePromise, reject) => {
    upload.options.onSuccess = () => resolvePromise();
    upload.options.onError = (error) => reject(error);
    upload.start();
  });
};

const runQa = async () => {
  requireEnv("TRANSLOADIT_KEY");
  requireEnv("TRANSLOADIT_SECRET");
  requireEnv("CONVEX_DEPLOY_KEY");

  const previewName = toPreviewName();
  let qaDir: string | null = null;
  try {
    qaDir = await mkdtemp(join(tmpdir(), "transloadit-convex-qa-"));
    const projectDir = join(qaDir, "app");
    const tgzPath = join(qaDir, "transloadit-convex.tgz");
    const imagePath = join(qaDir, "sample.png");
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

    await mkdir(projectDir, { recursive: true });
    await writeFile(imagePath, Buffer.from(pngBase64, "base64"));

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

    const deploymentName = parseDeployOutput(deployOutput);
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

    const steps: AssemblyInstructionsInput["steps"] = {
      ":original": { robot: "/upload/handle" },
      resize: {
        use: ":original",
        robot: "/image/resize",
        width: 320,
        height: 320,
        resize_strategy: "fit",
        result: true,
      },
    };

    console.log("Creating assembly...");
    const createResult = convexRun(
      projectDir,
      previewName,
      "transloadit:createAssembly",
      {
        steps,
        notifyUrl,
        numExpectedUploadFiles: 1,
      },
    ) as AssemblyResponse;

    const assemblyId = createResult?.assemblyId ?? "";
    const data = createResult?.data ?? {};
    const tusUrl = data.tus_url ?? "";
    const assemblyUrl = data.assembly_ssl_url ?? data.assembly_url ?? "";

    if (!assemblyId || !tusUrl || !assemblyUrl) {
      throw new Error("Missing assembly data from createAssembly");
    }

    console.log("Uploading via tus...");
    await runUpload(tusUrl, assemblyUrl, imagePath);

    const deadline = Date.now() + 120_000;
    let results: unknown[] = [];

    while (Date.now() < deadline) {
      results =
        (convexRun(projectDir, previewName, "transloadit:listResults", {
          assemblyId,
        }) as unknown[]) ?? [];
      if (Array.isArray(results) && results.length > 0) {
        break;
      }
      await sleep(3000);
    }

    if (!results.length) {
      const status = convexRun(
        projectDir,
        previewName,
        "transloadit:refreshAssembly",
        {
          assemblyId,
        },
      ) as Record<string, unknown> | null;
      console.log("Final status:", status);
      results =
        (convexRun(projectDir, previewName, "transloadit:listResults", {
          assemblyId,
        }) as unknown[]) ?? [];
    }

    if (!results.length) {
      throw new Error("Timed out waiting for results");
    }

    const resized = Array.isArray(results)
      ? results.find(
          (result) => (result as { stepName?: string }).stepName === "resize",
        )
      : null;

    if (!resized) {
      throw new Error("Missing resize result");
    }

    const resizedUrl = (resized as { sslUrl?: string }).sslUrl ?? null;
    if (!resizedUrl) {
      throw new Error("Missing sslUrl on resize result");
    }

    console.log(
      JSON.stringify(
        {
          previewName,
          deploymentName,
          notifyUrl,
          assemblyId,
          resizeUrl: resizedUrl,
          resultCount: Array.isArray(results) ? results.length : 0,
        },
        null,
        2,
      ),
    );
  } finally {
    if (qaDir && !process.env.QA_KEEP_TEMP) {
      await rm(qaDir, { recursive: true, force: true });
    }
  }
};

runQa().catch((error) => {
  console.error(error);
  process.exit(1);
});
