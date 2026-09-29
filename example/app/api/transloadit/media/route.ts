import { createStorageRoute, type StorageRoute } from '@transloadit/viewer/server'
import { authorizeAsset } from '../../../../lib/media-delivery'

// Explicit server-only delivery configuration: a least-privilege Smart CDN signing key for the
// album's Storage Workspace. Without it, private media stays unavailable rather than half-working.
let route: StorageRoute | null | undefined

const getRoute = () => {
  if (route !== undefined) return route
  const workspace =
    process.env.TRANSLOADIT_SMART_CDN_WORKSPACE || process.env.TRANSLOADIT_WORKSPACE || ''
  const authKey = process.env.TRANSLOADIT_SMART_CDN_KEY || ''
  const authSecret = process.env.TRANSLOADIT_SMART_CDN_SECRET || ''
  route =
    workspace && authKey && authSecret
      ? createStorageRoute({
          workspace,
          authKey,
          authSecret,
          authorizeAsset: ({ asset_id, version_id, action }) =>
            authorizeAsset({ asset_id, version_id, action }),
          // Five-minute grants signed per 150 s window: repeat views can reuse cached CDN URLs,
          // every request still reauthorizes, and a new URL keeps 150-300 s of validity.
          lifetimeMs: 300_000,
          rotationIntervalMs: 150_000,
          diagnostics: process.env.NODE_ENV === 'development',
        })
      : null
  return route
}

const unavailable = () =>
  new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })

export const dynamic = 'force-dynamic'

export const GET = (request: Request) => getRoute()?.GET(request) ?? unavailable()

export const HEAD = (request: Request) => getRoute()?.HEAD(request) ?? unavailable()
