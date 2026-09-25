import { vStoredAsset } from '@transloadit/convex'
import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { getAlbumStoragePrefix } from '../lib/storage'
import { components } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'

// Admin-only wrappers for scripts/cleanup-demo.ts. Guests can never hide or delete album media.

const pageSize = 500

// Each call reads one page in its own transaction; the script combines pages, so large albums
// never exceed a single query's read limits.
export const summary = internalQuery({
  args: { album: v.string() },
  returns: v.object({
    results: v.number(),
    resultsTruncated: v.boolean(),
    // Null when this deployment has no unambiguous Storage namespace.
    storagePrefix: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const results = await ctx.runQuery(components.transloadit.lib.listAlbumResults, {
      album: args.album,
      limit: pageSize,
    })
    return {
      results: results.length,
      resultsTruncated: results.length === pageSize,
      // Computed where upload paths are chosen, so custom client URLs cannot change the prefix.
      storagePrefix: getAlbumStoragePrefix(args.album) ?? null,
    }
  },
})

export const visiblePage = internalQuery({
  args: { album: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ count: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const page = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
      album: args.album,
      paginationOpts: { numItems: pageSize, cursor: args.cursor },
    })
    return { count: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})

export const previewExpiry = internalQuery({
  args: {
    album: v.string(),
    createdBefore: v.number(),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: (ctx, args) => ctx.runQuery(components.transloadit.lib.previewStoredAssetExpiry, args),
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
