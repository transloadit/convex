import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Browser, expect as browserExpect, chromium, type Page } from '@playwright/test'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { startGalleryFixture } from './support/gallery-server.ts'

let fixture: Awaited<ReturnType<typeof startGalleryFixture>>
let browser: Browser
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
function browserErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`)
  })
  page.on('requestfailed', (request) => {
    // Browser navigation can cancel speculative image requests; no other failures are ignored.
    if (request.failure()?.errorText !== 'net::ERR_ABORTED')
      errors.push(request.failure()?.errorText ?? 'Unknown request failure')
  })
  return errors
}
const mediaId = (index: number) => `${`${index}`.padEnd(21, 'x')}A.${'v'.repeat(21)}A`
beforeAll(async () => {
  fixture = await startGalleryFixture()
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL }
      : {},
  )
})
afterAll(async () => {
  await browser?.close()
  await fixture?.close()
})

test('next and rapid navigation never wait for a delayed image; Back/Forward and reload preserve exact media', async () => {
  const context = await browser.newContext({
    baseURL: fixture.url,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  const errors = browserErrors(page)
  let release = () => {}
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/transloadit/media?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('asset_id')?.startsWith('2')) await delayed
    await route.continue()
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'View photo-1.jpg' }).click()
    await browserExpect(page.getByRole('dialog', { name: 'photo-1.jpg' })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    const second = page.getByRole('dialog', { name: 'photo-2.jpg' })
    await browserExpect(second).toBeVisible({ timeout: 1000 })
    await browserExpect(second.getByRole('status')).toHaveText('Loading photo…')
    await browserExpect(second.getByRole('status')).toBeInViewport()
    expect(new URL(page.url()).searchParams.get('media')).toBe(mediaId(2))
    if (process.env.E2E_SCREENSHOT_DIR) {
      await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({
        path: join(process.env.E2E_SCREENSHOT_DIR, 'gallery-delayed-next.png'),
      })
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await browserExpect(page.getByRole('dialog', { name: 'photo-3.jpg' })).toBeVisible({
      timeout: 1000,
    })
    expect(new URL(page.url()).searchParams.get('media')).toBe(mediaId(3))
    release()
    await browserExpect(page.getByRole('dialog').getByRole('status')).toHaveCount(0)
    await page.goBack()
    await browserExpect(page.getByRole('dialog')).toHaveCount(0)
    await page.goForward()
    await browserExpect(page.getByRole('dialog', { name: 'photo-3.jpg' })).toBeVisible()
    await page.reload()
    await browserExpect(page.getByRole('dialog', { name: 'photo-3.jpg' })).toBeVisible()
    await page.getByRole('button', { name: 'Close viewer' }).click()
    await browserExpect(page.getByRole('dialog')).toHaveCount(0)
    // Reload has no thumbnail opener. Only a fresh thumbnail interaction can restore its focus.
    await page.getByRole('button', { name: 'View photo-3.jpg' }).click()
    await page.getByRole('button', { name: 'Close viewer' }).click()
    await browserExpect(page.getByRole('button', { name: 'View photo-3.jpg' })).toBeFocused()
    expect(errors).toEqual([])
  } finally {
    release()
    await context.close()
  }
})

test('preview feedback lasts through decoding, not only the image download', async () => {
  const context = await browser.newContext({ baseURL: fixture.url })
  await context.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = async function () {
      const release =
        this.alt === 'photo-2.jpg'
          ? new Promise<void>((resolve) =>
              document.addEventListener('release-photo-decode', () => resolve(), { once: true }),
            )
          : Promise.resolve()
      await decode.call(this)
      await release
    }
  })
  const page = await context.newPage()
  const errors = browserErrors(page)
  try {
    await page.goto(`/?media=${mediaId(2)}`)
    const dialog = page.getByRole('dialog', { name: 'photo-2.jpg' })
    await browserExpect
      .poll(() =>
        dialog
          .getByRole('img')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true)
    await browserExpect(dialog.getByRole('status')).toHaveText('Loading photo…')
    await page.evaluate(() => document.dispatchEvent(new Event('release-photo-decode')))
    await browserExpect(dialog.getByRole('status')).toHaveCount(0)
    await browserExpect(dialog.getByRole('img')).toBeInViewport()
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('only the next full photo is prefetched after current readiness, never on Save-Data', async () => {
  const context = await browser.newContext({
    baseURL: fixture.url,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  const fullPhotos: string[] = []
  const errors = browserErrors(page)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/transloadit/media' && Number(url.searchParams.get('w')) >= 1280)
      fullPhotos.push(url.searchParams.get('asset_id') ?? '')
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'View photo-1.jpg' }).click()
    await browserExpect.poll(() => fullPhotos.some((id) => id.startsWith('2'))).toBe(true)
    expect(fullPhotos.some((id) => id.startsWith('3'))).toBe(false)
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true, effectiveType: '4g' },
      }),
    )
    fullPhotos.length = 0
    await page.goto(`/?media=${mediaId(1)}`)
    await browserExpect(page.getByRole('dialog').getByRole('status')).toHaveCount(0)
    expect(fullPhotos.some((id) => id.startsWith('1'))).toBe(true)
    expect(fullPhotos.some((id) => id.startsWith('2') || id.startsWith('3'))).toBe(false)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('keyboard navigation remains inside the viewer when a focused boundary button becomes disabled', async () => {
  const context = await browser.newContext({ baseURL: fixture.url })
  const page = await context.newPage()
  const errors = browserErrors(page)
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'View photo-2.jpg' }).click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await browserExpect(page.getByRole('dialog', { name: 'photo-3.jpg' })).toBeVisible()
    await browserExpect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    await browserExpect(page.getByRole('button', { name: 'Previous', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await browserExpect(page.getByRole('dialog', { name: 'photo-2.jpg' })).toBeVisible()
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    await browserExpect(page.getByRole('dialog', { name: 'photo-1.jpg' })).toBeVisible()
    await browserExpect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await browserExpect(page.getByRole('button', { name: 'Next', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await browserExpect(page.getByRole('dialog', { name: 'photo-2.jpg' })).toBeVisible()
    await page.keyboard.press('Escape')
    await browserExpect(page.getByRole('dialog')).toHaveCount(0)
    await browserExpect(page.getByRole('button', { name: 'View photo-2.jpg' })).toBeFocused()
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('backward navigation warms only the previous neighbor after the current photo loads', async () => {
  const context = await browser.newContext({
    baseURL: fixture.url,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  const errors = browserErrors(page)
  const fullPhotos: string[] = []
  let release = () => {}
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/transloadit/media?**', async (route) => {
    const url = new URL(route.request().url())
    if (Number(url.searchParams.get('w')) >= 1280) {
      const id = url.searchParams.get('asset_id') ?? ''
      fullPhotos.push(id)
      if (id.startsWith('2')) await delayed
    }
    await route.continue()
  })
  try {
    await page.goto(`/?media=${mediaId(3)}`)
    await browserExpect(page.getByRole('dialog').getByRole('status')).toHaveCount(0)
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    await browserExpect(page.getByRole('dialog', { name: 'photo-2.jpg' })).toBeVisible()
    await browserExpect(page.getByRole('status')).toHaveText('Loading photo…')
    expect(fullPhotos.some((id) => id.startsWith('1'))).toBe(false)
    release()
    await browserExpect(page.getByRole('dialog').getByRole('status')).toHaveCount(0)
    await browserExpect.poll(() => fullPhotos.some((id) => id.startsWith('1'))).toBe(true)
    expect(errors).toEqual([])
  } finally {
    release()
    await context.close()
  }
})

test('shared links work on a narrow reduced-motion screen and invalid links stay closable', async () => {
  const context = await browser.newContext({
    baseURL: fixture.url,
    viewport: { width: 320, height: 740 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = browserErrors(page)
  try {
    await page.goto(`/?media=${mediaId(2)}&keep=1`)
    await browserExpect(page.getByRole('dialog', { name: 'photo-2.jpg' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await browserExpect(page.getByRole('dialog', { name: 'photo-1.jpg' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    if (process.env.E2E_SCREENSHOT_DIR) {
      await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.E2E_SCREENSHOT_DIR, 'gallery-mobile.png') })
    }
    await page.keyboard.press('Escape')
    await browserExpect(page.getByRole('dialog')).toHaveCount(0)
    expect(errors).toEqual([])
    expect(new URL(page.url()).search).toBe('?keep=1')
    await page.goto('/?media=missing')
    await browserExpect(page.getByRole('dialog').getByRole('alert')).toHaveText(
      'This memory is unavailable or no longer in the album.',
    )
    await page.getByRole('button', { name: 'Close viewer' }).click()
    await browserExpect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('a shared photo outside loaded pages has no invented neighbors or gallery position', async () => {
  const context = await browser.newContext({ baseURL: fixture.url })
  const page = await context.newPage()
  const errors = browserErrors(page)
  try {
    await page.goto(`/?media=${mediaId(99)}`)
    await browserExpect(page.getByRole('dialog', { name: 'photo-99.jpg' })).toBeVisible()
    await browserExpect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await browserExpect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    await page.keyboard.press('ArrowLeft')
    expect(new URL(page.url()).searchParams.get('media')).toBe(mediaId(99))
    await page.getByRole('button', { name: 'Close viewer' }).click()
    await browserExpect(page.getByRole('dialog')).toHaveCount(0)
    await browserExpect(page.getByRole('button', { name: /View photo-/ })).toHaveCount(3)
    await browserExpect(page.getByText('3 memories & counting', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
