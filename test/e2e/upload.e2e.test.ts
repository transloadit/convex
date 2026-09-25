import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect as browserExpect, chromium } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
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
const chromiumChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL

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
      // Exercise the deployment visitors actually open. A backend override hid broken previews.
      parsed.searchParams.delete('convexUrl')
      serverUrl = parsed.toString()
      return
    }

    app = await startExampleApp({
      env: {
        E2E_MODE: 'local',
        WEDDING_UPLOAD_CODE: 'browser-invitation-test',
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
    const browser = await chromium.launch(chromiumChannel ? { channel: chromiumChannel } : {})
    const page = await browser.newPage()
    let storedImageHref: string | undefined
    const appRequestHeaders: Record<string, string> = useRemote
      ? { 'x-vercel-protection-bypass': vercelBypassToken }
      : {}
    const localStatusRequests: number[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!useRemote && url.pathname === '/api/assemblies' && request.method() === 'GET') {
        localStatusRequests.push(Date.now())
      }
    })
    const connectedHosts = new Set<string>()
    page.on('websocket', (socket) => connectedHosts.add(new URL(socket.url()).host))
    await page.addInitScript(() => {
      const start = document.startViewTransition?.bind(document)
      if (!start) return
      const state = window as typeof window & {
        __viewTransitions: number
        __viewTransitionFinished?: Promise<void>
        __viewTransitionTrace: unknown[]
        __viewSlideFrames: { layer: string; transforms: string[] }[]
      }
      state.__viewTransitions = 0
      state.__viewTransitionTrace = []
      state.__viewSlideFrames = []
      document.startViewTransition = (...args) => {
        state.__viewTransitions += 1
        state.__viewSlideFrames = []
        const id = state.__viewTransitions
        const trace = (phase: string, error?: unknown) => {
          state.__viewTransitionTrace.push({
            id,
            phase,
            time: Math.round(performance.now()),
            media: document.querySelector('dialog .viewer-media')?.firstElementChild?.tagName,
            width: innerWidth,
            visibility: document.visibilityState,
            navigation: Boolean(window.navigation?.transition),
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            error: error instanceof Error ? error.message : error ? String(error) : undefined,
          })
        }
        trace('start')
        const transition = start(...args)
        state.__viewTransitionFinished = transition.finished
        transition.updateCallbackDone.then(
          () => trace('updated'),
          (error) => trace('update rejected', error),
        )
        transition.ready.then(
          () => {
            trace('ready')
            // Inspect the browser's actual animation layers after Motion has configured them.
            requestAnimationFrame(() => {
              state.__viewSlideFrames = document.getAnimations().flatMap(({ effect }) => {
                if (!(effect instanceof KeyframeEffect) || !effect.pseudoElement) return []
                return [
                  {
                    layer: effect.pseudoElement,
                    transforms: effect
                      .getKeyframes()
                      .map((frame) => String(frame.transform ?? 'none')),
                  },
                ]
              })
            })
          },
          (error) => trace('ready rejected', error),
        )
        transition.finished.then(
          () => trace('finished'),
          (error) => trace('finish rejected', error),
        )
        return transition
      }
    })
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
          if (new URL(url).origin !== appOrigin) {
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

      const entry = page.getByTestId('album-entry')
      await browserExpect(entry).toBeVisible()
      await browserExpect(page.getByTestId('gallery')).toHaveCount(0)
      await browserExpect(page.locator('.cover-image')).toHaveCount(0)
      expect(navigation?.headers()['x-robots-tag']).toContain('noindex')
      await browserExpect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
      if (useRemote && remoteConvexUrl) {
        const unauthenticated = new ConvexHttpClient(remoteConvexUrl)
        await expect(
          unauthenticated.query(makeFunctionReference<'query'>('wedding:listGallery'), {}),
        ).rejects.toThrow('ACCESS_REQUIRED')
      } else if (!useRemote) {
        const response = await page.request.get(`${serverUrl}/api/assemblies?assemblyId=private`)
        expect(response.status()).toBe(401)
      }
      const enter = entry.getByTestId('enter-album')
      await browserExpect(enter).toBeEnabled()
      const entryName = entry.getByRole('textbox', { name: 'Your name' })
      await browserExpect(entryName).toHaveValue('')
      await browserExpect(entryName).toHaveAttribute('placeholder', 'Guest')
      await enter.click()
      expect(
        await entryName.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
      ).toBe(true)
      if (process.env.E2E_SCREENSHOT_DIR) {
        mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.E2E_SCREENSHOT_DIR, 'entry-desktop.png') })
        await page.setViewportSize({ width: 320, height: 740 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
        await page.screenshot({ path: join(process.env.E2E_SCREENSHOT_DIR, 'entry-mobile.png') })
        await page.setViewportSize({ width: 1280, height: 720 })
      }
      await entryName.fill('Preview Guest')
      const invitation = entry.getByLabel('Invite code')
      if (!useRemote) {
        await browserExpect(invitation).toBeVisible()
        await invitation.fill('wrong-code')
        await enter.click()
        await browserExpect(entry.getByRole('alert')).toHaveText(
          'Please enter the correct invite code.',
        )
        await browserExpect(page.getByTestId('gallery')).toHaveCount(0)
      }
      if (await invitation.isVisible()) {
        const code = useRemote
          ? process.env.E2E_WEDDING_UPLOAD_CODE || process.env.WEDDING_UPLOAD_CODE
          : 'browser-invitation-test'
        if (!code) throw new Error('Set E2E_WEDDING_UPLOAD_CODE to test this code-protected album')
        await invitation.fill(code)
      }
      await enter.click()
      await browserExpect(entry).toBeHidden({ timeout: 60_000 })

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
          const bodyTextSnippet = await page
            .evaluate(() => document.body?.innerText?.slice(0, 500) ?? '')
            .catch(() => '')
          const authStorage = await page
            .evaluate(() => {
              const entries: string[] = []
              try {
                for (let index = 0; index < localStorage.length; index += 1) {
                  const key = localStorage.key(index)
                  if (!key) continue
                  if (!key.includes('__convexAuth')) continue
                  entries.push(key)
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
            bodyTextSnippet,
            authStorage,
            hasVercelProtection,
            url: new URL(page.url()).origin,
          })
          throw error
        }
        if (remoteConvexUrl) {
          expect(connectedHosts.has(new URL(remoteConvexUrl).host)).toBe(true)

          // A returning guest may still have a valid JWT for a session that no longer admits
          // them. End only this test's server session, retaining its browser storage.
          const previousToken = await page.evaluate(
            () =>
              Object.entries(localStorage).find(([key]) => key.startsWith('__convexAuthJWT_'))?.[1],
          )
          if (!previousToken) throw new Error('The test guest did not receive a session token')
          await page.goto('about:blank')
          const previousSession = new ConvexHttpClient(remoteConvexUrl, { logger: false })
          previousSession.setAuth(previousToken)
          await previousSession.action(makeFunctionReference<'action'>('auth:signOut'), {})
          await page.goto(serverUrl, { waitUntil: 'domcontentloaded' })
          await browserExpect(entry).toBeVisible()
          await browserExpect(enter).toBeEnabled()
          await entryName.fill('Preview Guest')
          if (await invitation.isVisible()) {
            const code = process.env.E2E_WEDDING_UPLOAD_CODE || process.env.WEDDING_UPLOAD_CODE
            if (!code)
              throw new Error('Set E2E_WEDDING_UPLOAD_CODE to re-enter this protected album')
            await invitation.fill(code)
          }
          await enter.click()
          await browserExpect(entry).toBeHidden({ timeout: 30_000 })
          await browserExpect(page.getByTestId('open-upload')).toBeVisible()
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

      await browserExpect(page.getByRole('heading', { level: 1 })).toHaveText('Eden & Nico')
      await browserExpect
        .poll(() =>
          page.locator('.cover-image').evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0)
      const openUpload = page.getByTestId('open-upload')
      const uploadDialog = page.getByRole('dialog', { name: 'Share your memories' })
      await browserExpect(uploadDialog).toBeHidden()
      await openUpload.click()
      await browserExpect(uploadDialog).toBeVisible()
      await browserExpect(uploadDialog.getByRole('button', { name: 'Close upload' })).toBeFocused()
      const guestName = uploadDialog.getByRole('textbox', { name: 'Your name' })
      await browserExpect(guestName).toHaveValue('Preview Guest')
      await browserExpect(guestName).toHaveAttribute('placeholder', 'Guest')
      await guestName.fill('')
      await uploadDialog.getByTestId('start-upload').click()
      expect(
        await guestName.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
      ).toBe(true)
      await guestName.fill('Preview Guest')

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
      // Browsing the album must not discard files already selected in the upload panel.
      await page.keyboard.press('Escape')
      await browserExpect(uploadDialog).toBeHidden()
      await browserExpect(openUpload).toBeFocused()
      // Locale changes update the existing uploader rather than remounting and losing the files.
      await page.getByRole('combobox').selectOption('nl')
      await openUpload.click()
      await browserExpect(page.getByRole('dialog', { name: 'Deel je herinneringen' })).toBeVisible()
      await browserExpect(page.getByRole('textbox', { name: 'Je naam' })).toHaveValue(
        'Preview Guest',
      )
      await browserExpect(page.locator('.uppy-Dashboard-Item')).toHaveCount(3)
      await page.keyboard.press('Escape')
      await page.getByRole('combobox').selectOption('en')
      await openUpload.click()
      await browserExpect(uploadDialog.locator('.uppy-Dashboard-Item')).toHaveCount(3)
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
      await browserExpect(page.getByTestId('upload-success')).toHaveText(
        '✓3 files successfully added×',
        { timeout: timeouts.outcome },
      )
      await browserExpect(uploadDialog).toBeHidden()
      await browserExpect(openUpload).toBeFocused()
      if (process.env.E2E_SCREENSHOT_DIR) {
        mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.E2E_SCREENSHOT_DIR, 'upload-success.png') })
      }
      await page.locator('#memories').scrollIntoViewIfNeeded()

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
          const imagesReady =
            imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0)
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

      if (!useRemote && localStatusRequests.length > 0) {
        const pollingDuration = Date.now() - localStatusRequests[0]
        // One initial poll, one explicit refresh after upload, and the four-second polling cadence.
        expect(localStatusRequests.length).toBeLessThanOrEqual(
          2 + Math.ceil(pollingDuration / 4000),
        )
      }

      const cards = page.locator(`[data-testid="gallery"] [data-assembly-id="${assemblyId}"]`)
      await browserExpect(cards).toHaveCount(3)
      if (process.env.E2E_EXPECT_STORAGE === '1') {
        const photos = cards.getByRole('img')
        await browserExpect(photos).toHaveCount(2)
        const sources = await photos.evaluateAll((images) =>
          images.map((image) => (image instanceof HTMLImageElement ? image.currentSrc : '')),
        )
        expect(
          sources.every((src) => {
            const url = new URL(src)
            return url.origin === appOrigin && url.pathname === '/api/transloadit/media'
          }),
        ).toBe(true)
        storedImageHref = sources[0]
        const anonymous = await browser.newContext()
        try {
          const denied = await anonymous.request.get(storedImageHref, {
            headers: appRequestHeaders,
            maxRedirects: 0,
          })
          expect(denied.status()).toBe(404)
          expect(denied.headers()['cache-control']).toContain('no-store')
        } finally {
          await anonymous.close()
        }
      }
      await browserExpect(cards.locator('.gallery-credit')).toHaveText(
        Array(3).fill('Added by Preview Guest'),
      )
      const allCards = page.locator('[data-testid="gallery"] [data-assembly-id]')
      const total = await allCards.count()
      const screenshots = process.env.E2E_SCREENSHOT_DIR
      if (screenshots) {
        mkdirSync(screenshots, { recursive: true })
        await page.screenshot({ path: join(screenshots, 'gallery-desktop.png'), fullPage: true })
      }
      const transitions = await page.evaluate(
        () => (window as typeof window & { __viewTransitions?: number }).__viewTransitions,
      )
      const photo = cards
        .filter({ has: page.locator('img') })
        .first()
        .getByRole('button')
      await photo.click()
      const viewer = page.getByRole('dialog')
      await browserExpect(viewer).toBeVisible()
      if (storedImageHref) {
        const href = await viewer
          .getByRole('link', { name: 'Download original' })
          .getAttribute('href')
        if (!href) throw new Error('A stored photo must expose its original download')
        const redirect = await page.request.get(new URL(href, serverUrl).href, {
          headers: appRequestHeaders,
          maxRedirects: 0,
        })
        expect(redirect.status()).toBe(307)
        expect(redirect.headers()['cache-control']).toContain('no-store')
        const location = redirect.headers().location
        if (!location) throw new Error('The original must redirect to the CDN')
        expect(new URL(location).origin === appOrigin).toBe(false)
        const original = await page.request.get(location)
        expect(original.ok()).toBe(true)
        const expectedHashes = [imagePath, imagePathAlt].map((path) =>
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        )
        expect(expectedHashes).toContain(
          createHash('sha256')
            .update(await original.body())
            .digest('hex'),
        )
      }
      await browserExpect(viewer.locator('.viewer-credit')).toHaveText('Added by Preview Guest')
      await browserExpect(viewer.getByRole('button', { name: 'Close viewer' })).toBeFocused()
      if (transitions !== undefined) {
        await browserExpect
          .poll(() =>
            page.evaluate(
              () => (window as typeof window & { __viewTransitions: number }).__viewTransitions,
            ),
          )
          .toBeGreaterThan(transitions)
        await page.evaluate(
          () =>
            (window as typeof window & { __viewTransitionFinished?: Promise<void> })
              .__viewTransitionFinished,
        )
      }
      await browserExpect(viewer.locator('img')).toHaveJSProperty('complete', true)
      const viewingBounds = await viewer.locator('img').boundingBox()
      expect(viewingBounds?.width).toBeGreaterThan(600)
      if (screenshots) {
        await page.screenshot({ path: join(screenshots, 'viewer-desktop.png') })
      }
      const photoTitle = await viewer.locator('.viewer-toolbar p').textContent()
      for (const direction of ['next', 'previous', 'batched next'] as const) {
        const before = await page.evaluate(
          () => (window as typeof window & { __viewTransitions: number }).__viewTransitions,
        )
        if (direction !== 'previous') {
          if (direction === 'batched next') {
            await viewer.evaluate((dialog) => {
              for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) {
                dialog.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
              }
            })
          } else {
            await page.keyboard.press('ArrowRight')
          }
          await browserExpect(viewer.locator('.viewer-toolbar p')).not.toHaveText(photoTitle ?? '')
        } else {
          await viewer.getByRole('button', { name: 'Previous' }).click()
          await browserExpect(viewer.locator('.viewer-toolbar p')).toHaveText(photoTitle ?? '')
        }
        if (before !== undefined) {
          await browserExpect
            .poll(() =>
              page.evaluate(
                () => (window as typeof window & { __viewTransitions: number }).__viewTransitions,
              ),
            )
            .toBeGreaterThan(before)
          const frames = await page.evaluate(async () => {
            const state = window as typeof window & {
              __viewTransitionFinished?: Promise<void>
              __viewSlideFrames: { layer: string; transforms: string[] }[]
            }
            await state.__viewTransitionFinished
            return state.__viewSlideFrames
          })
          const incoming = direction === 'previous' ? '-100' : '100'
          const outgoing = direction === 'previous' ? '100' : '-100'
          expect(frames).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                layer: expect.stringContaining('::view-transition-new('),
                transforms: [`translateX(${incoming}%)`, 'translateX(0%)'],
              }),
              expect.objectContaining({
                layer: expect.stringContaining('::view-transition-old('),
                transforms: expect.arrayContaining([`translateX(${outgoing}%)`]),
              }),
            ]),
          )
        }
      }
      await page.keyboard.press('Escape')
      await browserExpect(viewer).toHaveCount(0)
      await browserExpect(photo).toBeFocused()
      // The dialog disappears before Chrome finishes capturing its exit animation. Resizing during
      // that capture can stall the native transition, so finish it before the separate phone case.
      await page.evaluate(
        () =>
          (window as typeof window & { __viewTransitionFinished?: Promise<void> })
            .__viewTransitionFinished,
      )

      // Phone-sized viewing and reduced motion must keep every navigation control usable.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      )
      const reducedMotionTransitions = await page.evaluate(
        () => (window as typeof window & { __viewTransitions?: number }).__viewTransitions,
      )
      await allCards.first().getByRole('button').click()
      await browserExpect(viewer).toBeVisible()
      await browserExpect(viewer.getByRole('button', { name: 'Previous' })).toBeDisabled()
      await page.keyboard.press('ArrowRight')
      await browserExpect(viewer.locator('[aria-live="polite"]')).toHaveText(`2 / ${total}`)
      await viewer.getByRole('button', { name: 'Previous' }).click()
      await browserExpect(viewer.locator('[aria-live="polite"]')).toHaveText(`1 / ${total}`)
      await browserExpect(viewer.getByRole('button', { name: 'Previous' })).toBeDisabled()
      if (screenshots) {
        await page.screenshot({ path: join(screenshots, 'viewer-mobile.png') })
      }
      await viewer.getByRole('button', { name: 'Close viewer' }).click()
      await browserExpect(viewer).toHaveCount(0)
      expect(
        await page.evaluate(
          () => (window as typeof window & { __viewTransitions?: number }).__viewTransitions,
        ),
      ).toBe(reducedMotionTransitions)

      await cards
        .filter({ has: page.locator('video') })
        .first()
        .getByRole('button')
        .click()
      await browserExpect(viewer.locator('video')).toHaveJSProperty('controls', true)
      await browserExpect
        .poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
        .toBeGreaterThanOrEqual(1)
      await page.keyboard.press('Escape')
      await browserExpect(viewer).toHaveCount(0)
      await page.evaluate(
        () =>
          (window as typeof window & { __viewTransitionFinished?: Promise<void> })
            .__viewTransitionFinished,
      )
      await openUpload.click()
      const uploadBounds = await uploadDialog.boundingBox()
      expect(uploadBounds?.x).toBe(0)
      expect(uploadBounds?.width).toBe(390)
      expect((uploadBounds?.y ?? 0) + (uploadBounds?.height ?? 0)).toBeCloseTo(844, 0)
      expect(
        await uploadDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      ).toBe(true)
      await page.keyboard.press('Escape')
      await browserExpect(uploadDialog).toBeHidden()
      await browserExpect(openUpload).toBeFocused()
      // The uploader is ready for a new batch, and all shipped languages reach Uppy too.
      await openUpload.click()
      await guestName.fill('Another Guest')
      await fileInput.setInputFiles([imagePath])
      await uploadDialog.getByTestId('start-upload').click()
      await browserExpect(page.getByTestId('upload-success')).toHaveText(
        '✓1 file successfully added×',
        { timeout: timeouts.outcome },
      )
      await browserExpect(uploadDialog).toBeHidden()
      const secondAssemblyId = (await readText('[data-testid="assembly-id"]'))
        ?.replace('ID:', '')
        .trim()
      expect(secondAssemblyId).toBeTruthy()
      expect(secondAssemblyId).not.toBe(assemblyId)
      await browserExpect(
        page.locator(
          `[data-testid="gallery"] [data-assembly-id="${secondAssemblyId}"] .gallery-credit`,
        ),
      ).toHaveText(['Added by Another Guest'], { timeout: timeouts.results })
      for (const [locale, browseText] of [
        ['nl', 'blader naar bestanden'],
        ['de', 'Dateien durchsuchen'],
        ['uk', 'оберіть'],
      ]) {
        await page.getByRole('combobox').selectOption(locale)
        await browserExpect(page.locator('html')).toHaveAttribute('lang', locale)
        await openUpload.click()
        await browserExpect(page.locator('.uppy-Dashboard-Item')).toHaveCount(0)
        await browserExpect(
          page.locator('.upload-dialog').getByRole('button', { name: browseText, exact: true }),
        ).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          390,
        )
        if (process.env.E2E_SCREENSHOT_DIR)
          await page.screenshot({
            path: join(process.env.E2E_SCREENSHOT_DIR, `upload-${locale}-mobile.png`),
          })
        await page.keyboard.press('Escape')
      }
      await page.getByRole('combobox').selectOption('nl')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await browserExpect(page.locator('html')).toHaveAttribute('lang', 'nl')
      await browserExpect(openUpload).toHaveText('Foto’s delen')
      await openUpload.click()
      await browserExpect(page.getByRole('textbox', { name: 'Je naam' })).toHaveValue(
        'Preview Guest',
      )
      await page.keyboard.press('Escape')
      if (useRemote) {
        await browserExpect(cards.locator('.gallery-credit')).toHaveText(
          Array(3).fill('Toegevoegd door Preview Guest'),
          { timeout: 30_000 },
        )
      }
      await page.getByRole('button', { name: 'Album verlaten' }).click()
      await browserExpect(entry).toBeVisible()
      await browserExpect(page.getByTestId('gallery')).toHaveCount(0)
      if (storedImageHref) {
        const denied = await page.request.get(storedImageHref, {
          headers: appRequestHeaders,
          maxRedirects: 0,
        })
        expect(denied.status()).toBe(404)
        expect(denied.headers()['cache-control']).toContain('no-store')
      }
      // A crafted invitation URL cannot send credentials to a backend of its choice.
      const craftedUrl = new URL(serverUrl)
      craftedUrl.searchParams.set('convexUrl', 'https://example.invalid')
      await page.goto(craftedUrl.toString(), { waitUntil: 'domcontentloaded' })
      await browserExpect(entry).toBeVisible()
      await browserExpect(entry.getByTestId('enter-album')).toBeEnabled()
      await browserExpect(entry.getByRole('textbox', { name: 'Je naam' })).toHaveValue('')
      await browserExpect(page.getByTestId('gallery')).toHaveCount(0)
      if (!useRemote) {
        const response = await page.request.get(
          `${serverUrl}/api/assemblies?assemblyId=${assemblyId}`,
        )
        expect(response.status()).toBe(401)
      }
      expect(
        diagnostics.consoleMessages.filter((message) => message.startsWith('[pageerror]')),
      ).toEqual([])
    } catch (error) {
      diagnostics.dump()
      console.log(
        'View transition trace:',
        await page.evaluate(
          () =>
            (window as typeof window & { __viewTransitionTrace?: unknown[] }).__viewTransitionTrace,
        ),
      )
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
