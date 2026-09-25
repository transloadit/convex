// @vitest-environment node

import { getStorageAssetHref, Image } from '@transloadit/viewer/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const token = vi.fn<() => Promise<string | undefined>>()
const fetchQuery = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@convex-dev/auth/nextjs/server', () => ({ convexAuthNextjsToken: () => token() }))
vi.mock('convex/nextjs', () => ({ fetchQuery: (...args: unknown[]) => fetchQuery(...args) }))

const workspace = 'open-test-prod'
const receipt = {
  workspace,
  asset_id: 'SEjPlqU4M3ap8jxe9xUW5g',
  version_id: '5DaG-46XFJj8Bq5v4t6f8Q',
  path: 'convex-demo/local/wedding-gallery/upload/canary.jpg',
  size: 62125,
  mime: 'image/jpeg',
  width: 1600,
  height: 1067,
}
const origin = 'https://album.example.com'

// The browser-facing URLs come from the same React renderer the gallery uses.
const previewCandidates = () => {
  const html = renderToStaticMarkup(<Image src={receipt} alt="" sizes="33vw" />)
  return [...html.matchAll(/(\/api\/transloadit\/media\?[^\s",]+)/g)].map((match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  )
}

const load = async () => {
  vi.resetModules()
  return import('./route')
}

const get = async (path: string, method: 'GET' | 'HEAD' = 'GET') => {
  const { GET, HEAD } = await load()
  return (method === 'GET' ? GET : HEAD)(new Request(`${origin}${path}`, { method }))
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://example.convex.cloud')
  vi.stubEnv('TRANSLOADIT_SMART_CDN_WORKSPACE', workspace)
  vi.stubEnv('TRANSLOADIT_SMART_CDN_KEY', 'test-delivery-key')
  vi.stubEnv('TRANSLOADIT_SMART_CDN_SECRET', 'test-delivery-secret')
  token.mockResolvedValue('guest-jwt')
  fetchQuery.mockResolvedValue(receipt)
})

afterEach(() => {
  vi.unstubAllEnvs()
  token.mockReset()
  fetchQuery.mockReset()
})

describe('private media route', () => {
  test('redirects an authorized preview to a signed, exact-version CDN URL', async () => {
    const [candidate] = previewCandidates()
    expect(candidate).toBeDefined()
    const response = await get(candidate ?? '')
    expect(response.status).toBe(307)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.hostname).toBe(`${workspace}.tlcdn.com`)
    expect(decodeURIComponent(location.pathname)).toContain('builtin/storage-preview@')
    expect(location.searchParams.get('v')).toBe(receipt.version_id)
    expect(location.searchParams.get('sig')).toBeTruthy()
    // The Convex query receives the guest's cookie token and exactly the requested selection.
    expect(fetchQuery).toHaveBeenCalledWith(
      expect.anything(),
      { asset_id: receipt.asset_id, version_id: receipt.version_id, action: 'preview' },
      { token: 'guest-jwt', url: 'https://example.convex.cloud' },
    )
  })

  test('downloads use the trusted receipt filename and the same authorization', async () => {
    const response = await get(getStorageAssetHref(receipt, { action: 'download' }))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(decodeURIComponent(location.pathname)).toContain('builtin/storage-serve@')
    expect(location.searchParams.get('download')).toBe('canary.jpg')
    expect(fetchQuery.mock.calls[0]?.[1]).toMatchObject({ action: 'download' })
  })

  test.each([
    ['without a session cookie', () => token.mockResolvedValue(undefined)],
    ['when Convex denies the guest', () => fetchQuery.mockResolvedValue(null)],
    [
      'when the receipt names another version',
      () => fetchQuery.mockResolvedValue({ ...receipt, version_id: 'AAAAAAAAAAAAAAAAAAAAAA' }),
    ],
  ])('answers 404 without a CDN URL %s', async (_label, arrange) => {
    arrange()
    for (const method of ['GET', 'HEAD'] as const) {
      const response = await get(previewCandidates()[0] ?? '', method)
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
  })

  test('rejects tampered candidates and unknown parameters before asking Convex', async () => {
    const candidate = new URL(`${origin}${previewCandidates()[0] ?? ''}`)
    const tampered = [
      (url: URL) => url.searchParams.set('w', '1234'),
      (url: URL) => url.searchParams.set('f', 'gif'),
      (url: URL) => url.searchParams.set('q', '100'),
      (url: URL) => url.searchParams.append('w', '320'),
      (url: URL) => url.searchParams.set('asset_id', '../../etc'),
    ]
    for (const change of tampered) {
      const url = new URL(candidate)
      change(url)
      const response = await get(`${url.pathname}${url.search}`)
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
    }
    // Only the ladder check needs the authoritative receipt; malformed requests never reach it.
    expect(fetchQuery.mock.calls.length).toBeLessThanOrEqual(1)
  })

  test('reports backend failures as a sanitized server error', async () => {
    fetchQuery.mockRejectedValue(new Error('Convex unavailable: internal detail'))
    const response = await get(previewCandidates()[0] ?? '')
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('internal detail')
  })

  test('stays unavailable without delivery credentials', async () => {
    vi.stubEnv('TRANSLOADIT_SMART_CDN_KEY', '')
    const response = await get(previewCandidates()[0] ?? '')
    expect(response.status).toBe(404)
    expect(token).not.toHaveBeenCalled()
  })
})
