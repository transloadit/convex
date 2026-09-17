// @vitest-environment node

import { createTranslator } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import en from '../messages/en.json'
import WeddingUploadsPage from './page'

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: 'album') =>
    createTranslator({ locale: 'en', messages: en, namespace }),
}))

vi.mock('./WeddingUploadsApp', () => ({
  default: ({ convexUrl }: { convexUrl?: string | null }) => (
    <div data-testid="gallery" data-convex-url={convexUrl} />
  ),
}))

afterEach(() => vi.unstubAllEnvs())

describe('gallery deployment connection', () => {
  test('shows an unavailable state instead of guessing a Convex host from the preview branch', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'refresh-gallery')
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', undefined)
    vi.stubEnv('CONVEX_URL', undefined)

    const html = renderToStaticMarkup(await WeddingUploadsPage())
    expect(html).toContain('Gallery temporarily unavailable')
    expect(html).not.toContain('data-testid="gallery"')
    expect(html).not.toContain('refresh-gallery.convex.cloud')
  })

  test('connects the ordinary preview URL to its configured Convex deployment', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'refresh-gallery')
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://actual-preview.convex.cloud')

    const html = renderToStaticMarkup(await WeddingUploadsPage())
    expect(html).toContain('data-convex-url="https://actual-preview.convex.cloud"')
  })

  test('keeps local upload mode available outside Vercel', async () => {
    vi.stubEnv('VERCEL_ENV', undefined)
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', undefined)
    vi.stubEnv('CONVEX_URL', undefined)

    const html = renderToStaticMarkup(await WeddingUploadsPage())
    expect(html).toContain('data-testid="gallery"')
    expect(html).not.toContain('data-convex-url')
  })
})
