import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startExampleApp } from "./support/example-app.js";
import { runtime } from "./support/runtime.js";
import { sleep } from "./support/sleep.js";

const { authKey, authSecret, useRemote, remoteAppUrl, shouldRun } = runtime;

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
    if (useRemote) {
      if (!remoteAppUrl) {
        throw new Error("Missing E2E_REMOTE_APP_URL for cloud e2e run");
      }
      serverUrl = remoteAppUrl.replace(/\/$/, "");
      return;
    }

    app = await startExampleApp({
      env: {
        E2E_MODE: "local",
        TRANSLOADIT_KEY: authKey,
        TRANSLOADIT_SECRET: authSecret,
        TRANSLOADIT_R2_CREDENTIALS: process.env.TRANSLOADIT_R2_CREDENTIALS,
        R2_BUCKET: process.env.R2_BUCKET,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_HOST: process.env.R2_HOST,
        R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
      },
    });
    serverUrl = app.url;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
      app = null;
    }
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

      await page.waitForSelector('[data-testid="uppy-dashboard"]', {
        state: "attached",
      });

      const collectGalleryUrls = async () =>
        page.evaluate(() => {
          const gallery = document.querySelector('[data-testid="gallery"]');
          const images = Array.from(
            document.querySelectorAll<HTMLImageElement>(
              '[data-testid="gallery"] img',
            ),
          )
            .map((img) => img.currentSrc || img.src)
            .filter(Boolean);
          const videos = Array.from(
            document.querySelectorAll<HTMLVideoElement>(
              '[data-testid="gallery"] video',
            ),
          )
            .map((video) => video.currentSrc || video.src)
            .filter(Boolean);
          return {
            hasGallery: Boolean(gallery),
            images,
            videos,
          };
        });

      const initialGallery = await collectGalleryUrls();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: "attached" });
      await fileInput.setInputFiles([imagePath, videoPath]);
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

      const waitForStatus = async () => {
        const deadline = Date.now() + timeouts.refresh;
        while (Date.now() < deadline) {
          const text = await readText('[data-testid="assembly-status"]');
          if (text?.includes("ASSEMBLY_COMPLETED")) return;
          await sleep(2000);
        }
        throw new Error("Timed out waiting for assembly completion");
      };

      await waitForStatus();

      const waitForNewMedia = async () => {
        const deadline = Date.now() + timeouts.results;
        while (Date.now() < deadline) {
          const current = await collectGalleryUrls();
          if (!current.hasGallery) {
            await sleep(1000);
            continue;
          }

          const newImages = current.images.filter(
            (url) => !initialGallery.images.includes(url),
          );
          const newVideos = current.videos.filter(
            (url) => !initialGallery.videos.includes(url),
          );

          if (newImages.length > 0 && newVideos.length > 0) {
            const ready = await page.evaluate(() => {
              const imgs = Array.from(
                document.querySelectorAll<HTMLImageElement>(
                  '[data-testid="gallery"] img',
                ),
              );
              const vids = Array.from(
                document.querySelectorAll<HTMLVideoElement>(
                  '[data-testid="gallery"] video',
                ),
              );
              const imagesReady =
                imgs.length > 0 && imgs.every((img) => img.complete);
              const videosReady =
                vids.length > 0 &&
                vids.every(
                  (video) => video.readyState >= 2 || video.currentTime > 0,
                );
              return { imagesReady, videosReady };
            });

            if (ready.imagesReady && ready.videosReady) return;
          }

          await sleep(1000);
        }
        throw new Error("Timed out waiting for new gallery media to load");
      };

      await waitForNewMedia();
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
