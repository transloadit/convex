import { vStoredAsset } from '@transloadit/convex'
import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { getAlbumStoragePrefix } from '../lib/storage'
import { components } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'

// Admin-only wrappers for scripts/cleanup-demo.ts. Guests can never hide or delete album media.

const summaryPageSize = 500
const summaryPageLimit = 20

export const summary = internalQuery({
  args: { album: v.string(), createdBefore: v.number() },
  returns: v.object({
    visibleStoredAssets: v.number(),
    expiredStoredAssets: v.number(),
    results: v.number(),
    truncated: v.boolean(),
    storagePrefix: v.string(),
  }),
  handler: async (ctx, args) => {
    let visibleStoredAssets = 0
    let cursor: string | null = null
    let isDone = false
    for (let page = 0; page < summaryPageLimit && !isDone; page += 1) {
      const result = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
        album: args.album,
        paginationOpts: { numItems: summaryPageSize, cursor },
      })
      visibleStoredAssets += result.page.length
      isDone = result.isDone
      cursor = result.continueCursor
    }
    // The same selection as the real run: distinct assets whose newest version has expired.
    let expiredStoredAssets = 0
    let expiryCursor: string | undefined
    let expiryDone = false
    for (let page = 0; page < summaryPageLimit && !expiryDone; page += 1) {
      const preview = await ctx.runQuery(components.transloadit.lib.previewStoredAssetExpiry, {
        album: args.album,
        createdBefore: args.createdBefore,
        limit: summaryPageSize,
        ...(expiryCursor ? { cursor: expiryCursor } : {}),
      })
      expiredStoredAssets += preview.requested.length
      expiryDone = !preview.hasMore
      expiryCursor = preview.continueCursor
    }
    const results = await ctx.runQuery(components.transloadit.lib.listAlbumResults, {
      album: args.album,
      limit: summaryPageSize,
    })
    return {
      visibleStoredAssets,
      expiredStoredAssets,
      results: results.length,
      truncated: !isDone || !expiryDone || results.length === summaryPageSize,
      // Computed where upload paths are chosen, so custom client URLs cannot change the prefix.
      storagePrefix: getAlbumStoragePrefix(args.album),
    }
  },
})

export const requestDeletion = internalMutation({
  args: {
    album: v.string(),
    createdBefore: v.number(),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: (ctx, args) =>
    ctx.runMutation(components.transloadit.lib.requestStoredAssetDeletion, args),
})

export const adopt = internalMutation({
  args: { album: v.string(), assets: v.array(vStoredAsset) },
  handler: (ctx, args) =>
    ctx.runMutation(components.transloadit.lib.adoptStoredAssetsForDeletion, args),
})

export const pending = internalQuery({
  args: { album: v.string(), paginationOpts: paginationOptsValidator },
  handler: (ctx, args) => ctx.runQuery(components.transloadit.lib.listStoredAssetDeletions, args),
})

export const complete = internalMutation({
  args: { workspace: v.string(), assetId: v.string() },
  handler: (ctx, args) =>
    ctx.runMutation(components.transloadit.lib.completeStoredAssetDeletion, args),
})

export const fail = internalMutation({
  args: { workspace: v.string(), assetId: v.string(), error: v.string() },
  handler: (ctx, args) => ctx.runMutation(components.transloadit.lib.failStoredAssetDeletion, args),
})
