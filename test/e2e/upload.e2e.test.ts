import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { attachBrowserDiagnostics } from './support/diagnostics.js'
import { startExampleApp } from './support/example-app.js'
import { runtime } from './support/runtime.js'
import { sleep } from './support/sleep.js'

const { authKey, authSecret, useRemote, remoteAppUrl, shouldRun } = runtime

type DebugUppy = {
  getFiles?: () => unknown[]
  getPlugin?: (name: string) => { opts?: { endpoint?: string | null } } | null
  getState?: () => {
    currentUploads?: Record<string, unknown>
    uploads?: unknown
  }
}

const fixturesDir = resolve('test/e2e/fixtures')

const describeE2e = shouldRun ? describe : describe.skip

describeE2e('e2e upload flow', () => {
  const timeouts = {
    outcome: 180_000,
    results: 180_000,
    refresh: 240_000,
  }
  const vercelBypassToken = process.env.VERCEL_PROTECTION_BYPASS ?? ''
  const remoteConvexUrl = process.env.E2E_REMOTE_CONVEX_URL ?? ''
  let serverUrl = ''
  let app: Awaited<ReturnType<typeof startExampleApp>> | null = null

  beforeAll(async () => {
    if (useRemote) {
      if (!remoteAppUrl) {
        throw new Error('Missing E2E_REMOTE_APP_URL for cloud e2e run')
      }
      if (!vercelBypassToken) {
        throw new Error('Missing VERCEL_PROTECTION_BYPASS for cloud preview access')
      }
      const parsed = new URL(remoteAppUrl.replace(/\/$/, ''))
      parsed.searchParams.set('__vercel_protection_bypass', vercelBypassToken)
      if (remoteConvexUrl) {
        parsed.searchParams.set('convexUrl', remoteConvexUrl)
      }
      serverUrl = parsed.toString()
      return
    }

    app = await startExampleApp({
      env: {
        E2E_MODE: 'local',
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
    })
    serverUrl = app.url
  })

  afterAll(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  test('uploads wedding photos and videos', async () => {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    const appOrigin = useRemote ? new URL(serverUrl).origin : serverUrl
    const shouldTrackRequest = (url: string) =>
      url.includes('transloadit') ||
      url.includes('resumable') ||
      url.includes('convex.cloud') ||
      url.includes('convex.site') ||
      (appOrigin ? url.startsWith(appOrigin) : false)
    const diagnostics = attachBrowserDiagnostics(page, { shouldTrackRequest })

    try {
      if (useRemote && vercelBypassToken) {
        await page.route('**/*', async (route) => {
          const url = route.request().url()
          if (!url.startsWith(appOrigin)) {
            await route.continue()
            return
          }
          const headers = {
            ...route.request().headers(),
            'x-vercel-protection-bypass': vercelBypassToken,
            'x-vercel-set-bypass-cookie': 'true',
          }
          await route.continue({ headers })
        })
      }

      const navigation = await page.goto(serverUrl, {
        waitUntil: 'domcontentloaded',
      })

      if (useRemote) {
        try {
          await page.waitForSelector('[data-auth-state="authenticated"]', {
            timeout: 60_000,
          })
        } catch (error) {
          const title = await page.title().catch(() => null)
          const status = navigation?.status() ?? null
          const authState = await page
            .getAttribute('main.page', 'data-auth-state')
            .catch(() => null)
          const headingText = await page
            .locator('h1, h2')
            .first()
            .textContent()
            .catch(() => null)
          const headline = await page
            .locator('.headline')
            .first()
            .textContent()
            .catch(() => null)
          const bodyHtml = await page.evaluate(() => document.body?.outerHTML ?? '').catch(() => '')
          const bodyHtmlSnippet = bodyHtml.slice(0, 1000)
          const bodyTextSnippet = await page
            .evaluate(() => document.body?.innerText?.slice(0, 500) ?? '')
            .catch(() => '')
          const authStorage = await page
            .evaluate(() => {
              const entries: Array<{ key: string; value: string | null }> = []
              try {
                for (let index = 0; index < localStorage.length; index += 1) {
                  const key = localStorage.key(index)
                  if (!key) continue
                  if (!key.includes('__convexAuth')) continue
                  entries.push({ key, value: localStorage.getItem(key) })
                }
              } catch {
                return { error: 'localStorage unavailable' }
              }
              return entries
            })
            .catch(() => 'localStorage read failed')
          const hasVercelProtection = bodyHtml.includes('Vercel')
          console.log('Cloud auth wait failed.', {
            title,
            status,
            authState,
            headingText,
            headline,
            bodyHtmlSnippet,
            bodyTextSnippet,
            authStorage,
            hasVercelProtection,
            url: page.url(),
          })
          throw error
        }
      }

      const imagePath = join(fixturesDir, 'wedding-photo-01.png')
      const imagePathAlt = join(fixturesDir, 'wedding-photo-02.png')
      const videoPath = join(fixturesDir, 'wedding-video-01.mp4')
      if (!existsSync(imagePath) || !existsSync(imagePathAlt)) {
        throw new Error('Missing wedding photo fixtures for e2e run')
      }
      if (!existsSync(videoPath)) {
        throw new Error('Missing wedding video fixture for e2e run')
      }

      await page.waitForSelector('[data-testid="uppy-dashboard"]', {
        state: 'attached',
      })

      const fileInput = page.locator(
        '[data-testid="uppy-dashboard"] input.uppy-Dashboard-input[name="files[]"]:not([webkitdirectory])',
      )
      await fileInput.waitFor({ state: 'attached' })
      await fileInput.setInputFiles([imagePath, imagePathAlt, videoPath])
      await page.waitForFunction(
        () => document.querySelectorAll('.uppy-Dashboard-Item').length >= 2,
        undefined,
        { timeout: 20_000 },
      )
      await page.click('[data-testid="start-upload"]')

      const readText = async (selector: string) => {
        const element = await page.$(selector)
        if (!element) return null
        const text = await element.textContent()
        return text ?? null
      }

      const waitForOutcome = async () => {
        const deadline = Date.now() + timeouts.outcome
        while (Date.now() < deadline) {
          const assemblyText = await readText('[data-testid="assembly-id"]')
          if (assemblyText) {
            return { type: 'assembly', text: assemblyText }
          }

          const uploadError = await readText('[data-testid="upload-error"]')
          if (uploadError) {
            return { type: 'error', text: uploadError }
          }

          await page.waitForTimeout(1000)
        }

        return null
      }

      const outcome = await waitForOutcome()
      if (!outcome) {
        throw new Error('Timed out waiting for upload outcome')
      }
      if (outcome.type !== 'assembly') {
        throw new Error(`Upload failed: ${outcome.text}`)
      }

      const assemblyText = outcome.text
      const assemblyId = assemblyText?.replace('ID:', '').trim() ?? ''
      expect(assemblyId).not.toBe('')

      const readGalleryReady = async (targetAssemblyId: string) =>
        page.evaluate((assemblyId) => {
          const cards = Array.from(
            document.querySelectorAll<HTMLElement>('[data-assembly-id]'),
          ).filter((card) => card.dataset.assemblyId === assemblyId)
          const imgs = cards.flatMap((card) =>
            Array.from(card.querySelectorAll<HTMLImageElement>('img')),
          )
          const vids = cards.flatMap((card) =>
            Array.from(card.querySelectorAll<HTMLVideoElement>('video')),
          )
          const imagesReady = imgs.length > 0 && imgs.every((img) => img.complete)
          const videosReady =
            vids.length > 0 &&
            vids.every((video) => {
              const src = video.getAttribute('src')
              if (src && src.length > 0) return true
              const poster = video.getAttribute('poster')
              return Boolean(poster && poster.length > 0)
            })
          return {
            hasCards: cards.length > 0,
            imagesReady,
            videosReady,
          }
        }, targetAssemblyId)

      const waitForStatusOrGallery = async (targetAssemblyId: string) => {
        const deadline = Date.now() + timeouts.refresh
        let lastStatus: string | null = null
        while (Date.now() < deadline) {
          const text = await readText('[data-testid="assembly-status"]')
          if (text) {
            lastStatus = text
            if (text.includes('ASSEMBLY_COMPLETED')) return
            if (
              text.includes('ASSEMBLY_FAILED') ||
              text.includes('ASSEMBLY_CANCELED') ||
              text.includes('ASSEMBLY_ABORTED')
            ) {
              throw new Error(`Assembly ended unsuccessfully: ${text}`)
            }
          }
          const ready = await readGalleryReady(targetAssemblyId)
          if (ready.hasCards && ready.imagesReady && ready.videosReady) {
            return
          }
          await sleep(2000)
        }
        throw new Error(
          `Timed out waiting for assembly completion. Last status: ${lastStatus ?? 'unknown'}`,
        )
      }

      await waitForStatusOrGallery(assemblyId)

      const waitForAssemblyMedia = async (targetAssemblyId: string) => {
        const deadline = Date.now() + timeouts.results
        while (Date.now() < deadline) {
          const ready = await readGalleryReady(targetAssemblyId)

          if (!ready.hasCards) {
            await sleep(1000)
            continue
          }
          if (ready.imagesReady && ready.videosReady) return
          await sleep(1000)
        }
        throw new Error('Timed out waiting for gallery media to load')
      }

      await waitForAssemblyMedia(assemblyId)
    } catch (error) {
      diagnostics.dump()
      const uppyState = await page
        .evaluate(() => {
          const uppy = (window as { __uppy?: DebugUppy }).__uppy
          if (!uppy) return null
          const state = uppy.getState?.() ?? {}
          return {
            fileCount: uppy.getFiles?.().length ?? 0,
            hasTusPlugin: Boolean(uppy.getPlugin?.('Tus')),
            tusEndpoint: uppy.getPlugin?.('Tus')?.opts?.endpoint ?? null,
            uploadState: state.uploads ?? null,
            currentUploads: state.currentUploads ?? null,
            files: uppy.getFiles?.().map((file) => ({
              id: (file as { id?: string }).id ?? '',
              tusEndpoint: (file as { tus?: { endpoint?: string | null } }).tus?.endpoint ?? null,
            })),
          }
        })
        .catch(() => null)
      if (uppyState) {
        console.log('Uppy state:', uppyState)
      }
      throw error
    } finally {
      await browser.close()
    }
  })
})
