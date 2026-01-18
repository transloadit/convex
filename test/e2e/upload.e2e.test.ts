import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { weddingStepNames } from "../../example/lib/transloadit";
import { startExampleApp } from "./support/example-app.js";
import { runtime } from "./support/runtime.js";
import { sleep } from "./support/sleep.js";

const { authKey, authSecret, useRemote, remoteUrl, remoteAdminKey, shouldRun } =
  runtime;

const fixturesDir = resolve("test/e2e/fixtures");

const describeE2e = shouldRun ? describe : describe.skip;

describeE2e("e2e upload flow", () => {
  const timeouts = {
    outcome: 180_000,
    results: 180_000,
    refresh: 240_000,
  };
  let serverUrl = "";
  let app: Awaited<ReturnType<typeof startExampleApp>> | null = null;

  beforeAll(async () => {
    app = await startExampleApp({
      env: {
        E2E_MODE: useRemote ? "cloud" : "local",
        E2E_REMOTE_URL: remoteUrl,
        E2E_REMOTE_ADMIN_KEY: remoteAdminKey,
        TRANSLOADIT_KEY: authKey,
        TRANSLOADIT_SECRET: authSecret,
      },
    });
    serverUrl = app.url;
  });

  afterAll(async () => {
    await app?.close();
    app = null;
  });

  test("uploads wedding photos and videos", async () => {
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
      const imagePath = join(tempDir, "sample.png");
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
      await writeFile(imagePath, Buffer.from(pngBase64, "base64"));
      const videoPath = join(fixturesDir, "sample.mp4");
      if (!existsSync(videoPath)) {
        throw new Error("Missing sample.mp4 fixture for e2e run");
      }

      await page.waitForSelector(
        '[data-testid="uppy-dashboard"] input[type="file"]',
        { state: "attached" },
      );
      await page.setInputFiles(
        '[data-testid="uppy-dashboard"] input[type="file"]',
        [imagePath, videoPath],
      );
      await page.click('[data-testid="start-upload"]');

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

      const fetchAssembly = async (refresh = false) => {
        const params = new URLSearchParams({ assemblyId });
        if (refresh) params.set("refresh", "1");
        const response = await fetch(
          `${serverUrl}/api/assemblies?${params.toString()}`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch assembly results");
        }
        return (await response.json()) as {
          status: { ok?: string } | null;
          results: Array<{ stepName?: string; sslUrl?: string }>;
        };
      };

      const waitForResults = async (timeoutMs: number) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const data = await fetchAssembly();
          if (data.results.length > 0) {
            return data;
          }
          await sleep(2000);
        }
        return null;
      };

      let data = await waitForResults(timeouts.results);
      if (!data) {
        data = await fetchAssembly(true);
        const refreshDeadline = Date.now() + timeouts.refresh;
        while (
          Date.now() < refreshDeadline &&
          (!data.results || data.results.length === 0)
        ) {
          await sleep(3000);
          data = await fetchAssembly(true);
        }
      }

      if (!data || data.results.length === 0) {
        throw new Error("No processed results returned");
      }

      const image = data.results.find(
        (result) => result.stepName === weddingStepNames.image,
      );
      const video = data.results.find(
        (result) => result.stepName === weddingStepNames.video,
      );

      expect(image?.sslUrl).toMatch(/^https:\/\//);
      expect(video?.sslUrl).toMatch(/^https:\/\//);
      expect(data.status?.ok).toBe("ASSEMBLY_COMPLETED");

      await page.waitForSelector('[data-testid="gallery"]', {
        timeout: 30_000,
      });
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
