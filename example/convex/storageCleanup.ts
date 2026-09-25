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
    let expiredStoredAssets = 0
    let cursor: string | null = null
    let isDone = false
    // Expired receipts are the oldest ones, so count across pages rather than the newest page.
    for (let page = 0; page < summaryPageLimit && !isDone; page += 1) {
      const result = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
        album: args.album,
        paginationOpts: { numItems: summaryPageSize, cursor },
      })
      visibleStoredAssets += result.page.length
      expiredStoredAssets += result.page.filter((row) => row.createdAt < args.createdBefore).length
      isDone = result.isDone
      cursor = result.continueCursor
    }
    const results = await ctx.runQuery(components.transloadit.lib.listAlbumResults, {
      album: args.album,
      limit: summaryPageSize,
    })
    return {
      visibleStoredAssets,
      expiredStoredAssets,
      results: results.length,
      truncated: !isDone || results.length === summaryPageSize,
      // Computed where upload paths are chosen, so custom client URLs cannot change the prefix.
      storagePrefix: getAlbumStoragePrefix(args.album),
    }
  },
})

export const requestDeletion = internalMutation({
  args: { album: v.string(), createdBefore: v.number(), limit: v.number() },
  handler: (ctx, args) =>
    ctx.runMutation(components.transloadit.lib.requestStoredAssetDeletion, args),
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
