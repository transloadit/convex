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
  const vercelBypassToken = process.env.VERCEL_PROTECTION_BYPASS ?? "";
  const remoteConvexUrl = process.env.E2E_REMOTE_CONVEX_URL ?? "";
  let serverUrl = "";
  let app: Awaited<ReturnType<typeof startExampleApp>> | null = null;

  beforeAll(async () => {
    if (useRemote) {
      if (!remoteAppUrl) {
        throw new Error("Missing E2E_REMOTE_APP_URL for cloud e2e run");
      }
      if (!vercelBypassToken) {
        throw new Error(
          "Missing VERCEL_PROTECTION_BYPASS for cloud preview access",
        );
      }
      const parsed = new URL(remoteAppUrl.replace(/\/$/, ""));
      parsed.searchParams.set("__vercel_protection_bypass", vercelBypassToken);
      if (remoteConvexUrl) {
        parsed.searchParams.set("convexUrl", remoteConvexUrl);
      }
      serverUrl = parsed.toString();
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
    const shouldTrackRequest = (url: string) =>
      url.includes("transloadit") ||
      url.includes("resumable") ||
      url.includes("convex.cloud") ||
      url.includes("convex.site");

    page.on("requestfailed", (request) => {
      const url = request.url();
      if (shouldTrackRequest(url)) {
        requestFailures.push(`${url} ${request.failure()?.errorText ?? ""}`);
      }
    });
    page.on("request", (request) => {
      const url = request.url();
      if (shouldTrackRequest(url)) {
        requestLog.push(
          `${new Date().toISOString()} ${request.method()} ${url}`,
        );
      }
    });

    try {
      if (useRemote && vercelBypassToken) {
        await page.setExtraHTTPHeaders({
          "x-vercel-protection-bypass": vercelBypassToken,
          "x-vercel-set-bypass-cookie": "true",
        });
      }

      await page.goto(serverUrl, { waitUntil: "domcontentloaded" });

      if (useRemote) {
        try {
          await page.waitForSelector('[data-auth-state="authenticated"]', {
            timeout: 60_000,
          });
        } catch (error) {
          const authState = await page
            .getAttribute("main.page", "data-auth-state")
            .catch(() => null);
          const headline = await page
            .locator(".headline")
            .first()
            .textContent()
            .catch(() => null);
          const bodySnippet = await page
            .evaluate(() => document.body?.innerText?.slice(0, 500) ?? "")
            .catch(() => "");
          console.log("Cloud auth wait failed.", {
            authState,
            headline,
            bodySnippet,
            url: page.url(),
          });
          throw error;
        }
      }

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

      const waitForAssemblyMedia = async (targetAssemblyId: string) => {
        const deadline = Date.now() + timeouts.results;
        while (Date.now() < deadline) {
          const ready = await page.evaluate((assemblyId) => {
            const cards = Array.from(
              document.querySelectorAll<HTMLElement>("[data-assembly-id]"),
            ).filter((card) => card.dataset.assemblyId === assemblyId);
            const imgs = cards.flatMap((card) =>
              Array.from(card.querySelectorAll<HTMLImageElement>("img")),
            );
            const vids = cards.flatMap((card) =>
              Array.from(card.querySelectorAll<HTMLVideoElement>("video")),
            );
            const imagesReady =
              imgs.length > 0 && imgs.every((img) => img.complete);
            const videosReady =
              vids.length > 0 &&
              vids.every(
                (video) => video.readyState >= 2 || video.currentTime > 0,
              );
            return {
              hasCards: cards.length > 0,
              imagesReady,
              videosReady,
            };
          }, targetAssemblyId);

          if (!ready.hasCards) {
            await sleep(1000);
            continue;
          }
          if (ready.imagesReady && ready.videosReady) return;
          await sleep(1000);
        }
        throw new Error("Timed out waiting for gallery media to load");
      };

      await waitForAssemblyMedia(assemblyId);
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
