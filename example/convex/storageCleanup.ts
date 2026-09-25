import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { getAlbumStoragePrefix } from '../lib/storage'
import { components } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'

// Admin-only wrappers for scripts/cleanup-demo.ts. Guests can never hide or delete album media.

const summaryLimit = 500

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
    // A dry run reads the newest window only and says so: expired receipts are the oldest ones.
    const visible = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
      album: args.album,
      limit: summaryLimit,
    })
    const results = await ctx.runQuery(components.transloadit.lib.listAlbumResults, {
      album: args.album,
      limit: summaryLimit,
    })
    return {
      visibleStoredAssets: visible.page.length,
      expiredStoredAssets: visible.page.filter((row) => row.createdAt < args.createdBefore).length,
      results: results.length,
      truncated: visible.hasMore || results.length === summaryLimit,
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
