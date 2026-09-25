// @vitest-environment node

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const token = vi.fn<() => Promise<string | undefined>>()
const fetchQuery = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@convex-dev/auth/nextjs/server', () => ({ convexAuthNextjsToken: () => token() }))
vi.mock('convex/nextjs', () => ({ fetchQuery: (...args: unknown[]) => fetchQuery(...args) }))

const { authorizeAsset } = await import('./media-delivery')
const request = { asset_id: 'asset', version_id: 'version', action: 'preview' } as const

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://example.convex.cloud'))
afterEach(() => {
  vi.unstubAllEnvs()
  token.mockReset()
  fetchQuery.mockReset()
})

test('asks the album authorization query with the guest cookie token', async () => {
  token.mockResolvedValue('guest-jwt')
  fetchQuery.mockResolvedValue({ workspace: 'w', asset_id: 'asset', version_id: 'version' })
  await expect(authorizeAsset(request)).resolves.toMatchObject({ asset_id: 'asset' })
  expect(fetchQuery).toHaveBeenCalledWith(expect.anything(), request, {
    token: 'guest-jwt',
    url: 'https://example.convex.cloud',
  })
})

test('denies without a session cookie or deployment, without querying Convex', async () => {
  token.mockResolvedValue(undefined)
  await expect(authorizeAsset(request)).resolves.toBeNull()
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', '')
  vi.stubEnv('CONVEX_URL', '')
  token.mockResolvedValue('guest-jwt')
  await expect(authorizeAsset(request)).resolves.toBeNull()
  expect(fetchQuery).not.toHaveBeenCalled()
})

test('propagates backend failures instead of reporting a missing asset', async () => {
  token.mockResolvedValue('guest-jwt')
  fetchQuery.mockRejectedValue(new Error('Convex unavailable'))
  await expect(authorizeAsset(request)).rejects.toThrow('Convex unavailable')
})
