import 'server-only'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'
import type { StoredAsset } from '@transloadit/convex'
import { fetchQuery } from 'convex/nextjs'
import { makeFunctionReference } from 'convex/server'
import { getConvexUrl } from './convex-url'

export type MediaAction = 'preview' | 'original' | 'download'

export type MediaRequest = { asset_id: string; version_id: string; action: MediaAction }

const forDelivery = makeFunctionReference<'query', MediaRequest, StoredAsset | null>(
  'media:forDelivery',
)

/**
 * Authorizes one delivery request from the guest's httpOnly Convex Auth cookie. A single Convex
 * query checks the live session, current invitation, album, exact version and action, and returns
 * the stored receipt; without a session there is nothing to ask. Backend failures propagate so the
 * route can answer with a sanitized error instead of pretending the asset does not exist.
 */
export const authorizeAsset = async ({
  asset_id,
  version_id,
  action,
}: MediaRequest): Promise<StoredAsset | null> => {
  const url = getConvexUrl()
  const token = url ? await convexAuthNextjsToken() : undefined
  if (!url || !token) return null
  return fetchQuery(forDelivery, { asset_id, version_id, action }, { token, url })
}
