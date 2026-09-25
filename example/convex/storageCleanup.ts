import { v } from 'convex/values'
import { album } from '../lib/album-access'
import { components } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'

// Admin-only wrappers for scripts/cleanup-demo.ts. Guests can never hide or delete album media.

const summaryLimit = 1000

export const summary = internalQuery({
  args: { createdBefore: v.number() },
  returns: v.object({
    visibleStoredAssets: v.number(),
    expiredStoredAssets: v.number(),
    results: v.number(),
  }),
  handler: async (ctx, args) => {
    const visible = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
      album,
      paginationOpts: { numItems: summaryLimit, cursor: null },
    })
    const results = await ctx.runQuery(components.transloadit.lib.listAlbumResults, {
      album,
      limit: summaryLimit,
    })
    return {
      visibleStoredAssets: visible.page.length,
      expiredStoredAssets: visible.page.filter((row) => row.createdAt < args.createdBefore).length,
      results: results.length,
    }
  },
})

export const requestDeletion = internalMutation({
  args: { createdBefore: v.number(), limit: v.number() },
  handler: (ctx, args) =>
    ctx.runMutation(components.transloadit.lib.requestStoredAssetDeletion, { album, ...args }),
})

export const pending = internalQuery({
  args: { limit: v.number() },
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
