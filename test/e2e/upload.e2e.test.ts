import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createConvexRunner } from "./support/convex.js";
import { setupHarness } from "./support/harness.js";
import { runtime } from "./support/runtime.js";
import { sleep } from "./support/sleep.js";
import type { WebhookPayload } from "./support/webhook.js";

const {
  authKey,
  authSecret,
  useRemote,
  remoteUrl,
  remoteAdminKey,
  remoteNotifyUrl,
  appVariant,
  templateId,
  useTemplate,
  shouldRun,
  slowMode,
} = runtime;

const fixturesDir = resolve("test/e2e/fixtures");
const distDir = resolve("dist");

const describeE2e = shouldRun ? describe : describe.skip;

describeE2e("e2e upload flow", () => {
  const steps = slowMode
    ? {
        ":original": {
          robot: "/upload/handle",
        },
        encode: {
          use: ":original",
          robot: "/video/encode",
          preset: "mp4",
          result: true,
        },
      }
    : {
        ":original": {
          robot: "/upload/handle",
        },
        resize: {
          use: ":original",
          robot: "/image/resize",
          width: 320,
          height: 320,
          resize_strategy: "fit",
          result: true,
        },
      };
  const expectedStepName = slowMode ? "encode" : "resize";
  const timeouts = slowMode
    ? {
        outcome: 120_000,
        upload: 180_000,
        results: 120_000,
        assembly: 240_000,
      }
    : {
        outcome: 90_000,
        upload: 120_000,
        results: 60_000,
        assembly: 120_000,
      };
  let serverUrl = "";
  let harness: Awaited<ReturnType<typeof setupHarness>> | null = null;
  let webhookCount = 0;
  let lastWebhookPayload: WebhookPayload | null = null;
  let lastWebhookError: unknown = null;

  const { connect, runAction, runQuery } = createConvexRunner({
    useRemote,
    remoteUrl,
    remoteAdminKey,
    authKey,
    authSecret,
  });

  beforeAll(async () => {
    const distEntry = join(distDir, "react", "index.js");
    if (!existsSync(distEntry)) {
      throw new Error(
        "Missing dist artifacts. Run `yarn build` before running e2e tests.",
      );
    }

    if (useRemote) {
      connect();
    }

    harness = await setupHarness({
      appVariant,
      useTemplate,
      templateId,
      useRemote,
      remoteUrl,
      remoteNotifyUrl,
      steps,
      runAction,
      runQuery,
      onWebhook: (payload) => {
        webhookCount += 1;
        lastWebhookPayload = payload;
      },
      onWebhookError: (error) => {
        lastWebhookError = error;
      },
    });
    serverUrl = harness.serverUrl;
  });

  afterAll(async () => {
    await harness?.close();
    harness = null;
  });

  test("uploads and receives resized webhook payload", async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMessages: string[] = [];
    const requestFailures: string[] = [];
    const requestLog: string[] = [];

    page.on("console", (message) => {
      consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      consoleMessages.push(`[pageerror] ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (url.includes("transloadit") || url.includes("resumable")) {
        requestFailures.push(`${url} ${request.failure()?.errorText ?? ""}`);
      }
    });
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("transloadit") || url.includes("resumable")) {
        requestLog.push(
          `${new Date().toISOString()} ${request.method()} ${url}`,
        );
      }
    });

    try {
      await page.goto(serverUrl, { waitUntil: "domcontentloaded" });

      const tempDir = await mkdtemp(join(tmpdir(), "transloadit-e2e-"));
      let uploadPath = "";
      if (slowMode) {
        uploadPath = join(fixturesDir, "sample.mp4");
        if (!existsSync(uploadPath)) {
          throw new Error("Missing sample.mp4 fixture for slow e2e run");
        }
      } else {
        uploadPath = join(tempDir, "sample.png");
        const pngBase64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
        await writeFile(uploadPath, Buffer.from(pngBase64, "base64"));
      }

      await page.setInputFiles('[data-testid="file-input"]', uploadPath);

      const readText = async (selector: string) => {
        const element = await page.$(selector);
        if (!element) return null;
        const text = await element.textContent();
        return text ?? null;
      };

      const waitForOutcome = async () => {
        const deadline = Date.now() + timeouts.outcome;
        while (Date.now() < deadline) {
          const assemblyText = await readText('[data-testid="assembly-id"]');
          if (assemblyText) {
            return { type: "assembly", text: assemblyText };
          }

          const uploadError = await readText('[data-testid="upload-error"]');
          if (uploadError) {
            return { type: "error", text: uploadError };
          }

          const configError = await readText('[data-testid="config-error"]');
          if (configError) {
            return { type: "config", text: configError };
          }

          await page.waitForTimeout(1000);
        }

        return null;
      };

      const outcome = await waitForOutcome();
      if (!outcome) {
        throw new Error("Timed out waiting for upload outcome");
      }
      if (outcome.type !== "assembly") {
        throw new Error(`Upload failed: ${outcome.text}`);
      }

      const assemblyText = outcome.text;
      const assemblyId = assemblyText?.replace("ID:", "").trim() ?? "";
      expect(assemblyId).not.toBe("");

      const waitForUploadCompletion = async () => {
        const start = Date.now();
        const deadline = start + timeouts.upload;
        let sawProgress = false;
        while (Date.now() < deadline) {
          const uploadError = await readText('[data-testid="upload-error"]');
          if (uploadError) {
            throw new Error(`Upload failed: ${uploadError}`);
          }

          const progress = await page.$('[data-testid="upload-progress"]');
          if (progress) {
            sawProgress = true;
          } else if (sawProgress) {
            return;
          } else if (Date.now() - start > 10_000) {
            return;
          }

          await page.waitForTimeout(1000);
        }

        if (sawProgress) {
          throw new Error("Upload did not complete within timeout");
        }
      };

      await waitForUploadCompletion();

      const waitForResults = async (timeoutMs: number) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const results = await runQuery("listResults", { assemblyId });
          if (results.length > 0) {
            return results;
          }
          await sleep(1500);
        }
        return [];
      };

      let results = await waitForResults(timeouts.results);
      if (!results.length) {
        console.log("Webhook count:", webhookCount);
        console.log("Last webhook payload:", lastWebhookPayload);
        console.log("Last webhook error:", lastWebhookError);

        const waitForAssembly = async () => {
          const deadline = Date.now() + timeouts.assembly;
          while (Date.now() < deadline) {
            const refreshArgs =
              !useRemote && authKey && authSecret
                ? { assemblyId, config: { authKey, authSecret } }
                : { assemblyId };
            const refresh = await runAction("refreshAssembly", refreshArgs);

            const ok = typeof refresh.ok === "string" ? refresh.ok : "";
            if (ok === "ASSEMBLY_COMPLETED") {
              return refresh;
            }
            if (
              ok &&
              ok !== "ASSEMBLY_EXECUTING" &&
              ok !== "ASSEMBLY_UPLOADING"
            ) {
              throw new Error(`Assembly failed with status ${ok}`);
            }

            await sleep(3000);
          }
          return null;
        };

        await waitForAssembly();

        results = await waitForResults(timeouts.results);
      }

      const resized = Array.isArray(results)
        ? results.find((result) => result?.stepName === expectedStepName)
        : null;

      expect(resized).toBeTruthy();
      expect(typeof resized.sslUrl).toBe("string");
      expect(resized.sslUrl).toMatch(/^https:\/\//);

      const storedStatus = await runQuery("getAssemblyStatus", {
        assemblyId,
      });
      expect(storedStatus?.ok).toBe("ASSEMBLY_COMPLETED");
    } catch (error) {
      if (consoleMessages.length) {
        console.log("Browser console logs:", consoleMessages);
      }
      if (requestFailures.length) {
        console.log("Browser request failures:", requestFailures);
      }
      if (requestLog.length) {
        const tail = requestLog.slice(-200);
        console.log("Browser request log (last 200):", tail);
      }
      throw error;
    } finally {
      await browser.close();
    }
  });
});
