import { vStoredAsset, type vStoredAssetResponse } from '@transloadit/convex'
import { paginationOptsValidator } from 'convex/server'
import { type Infer, v } from 'convex/values'
import { album } from '../lib/album-access'
import { getStorageWorkspace, isInUploadStoragePrefix } from '../lib/storage'
import { components } from './_generated/api'
import { type QueryCtx, query } from './_generated/server'
import { findGuest, requireGuest } from './guests'

type StoredAssetRow = Infer<typeof vStoredAssetResponse>

const vAction = v.union(v.literal('preview'), v.literal('original'), v.literal('download'))

const vGalleryAsset = v.object({
  id: v.string(),
  asset: vStoredAsset,
  uploadedBy: v.string(),
  createdAt: v.number(),
})

const findUpload = (ctx: QueryCtx, uploadId: string) =>
  ctx.db
    .query('uploads')
    .withIndex('by_uploadId', (q) => q.eq('uploadId', uploadId))
    .unique()

// A receipt's signed fields name an upload; it counts only when that server-created upload is in
// this album, belongs to the same guest and reserved the prefix the file was written to.
const findBoundUpload = async (ctx: QueryCtx, row: StoredAssetRow) => {
  if (row.album !== album || !row.uploadId || !row.userId) return null
  const upload = await findUpload(ctx, row.uploadId)
  if (
    !upload ||
    upload.album !== album ||
    upload.userId !== row.userId ||
    !upload.storagePrefix ||
    !isInUploadStoragePrefix(row.asset.path, upload.storagePrefix)
  )
    return null
  return upload
}

/** Newest private photos for admitted guests: canonical receipts, never URLs or credentials. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(vGalleryAsset),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireGuest(ctx)
    const result = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
      album,
      paginationOpts: args.paginationOpts,
    })
    const page = []
    for (const row of result.page) {
      const upload = await findBoundUpload(ctx, row)
      if (!upload) continue
      const { workspace, asset_id, version_id } = row.asset
      page.push({
        id: `${workspace}:${asset_id}:${version_id}`,
        asset: row.asset,
        uploadedBy: upload.guestName,
        createdAt: row.createdAt,
      })
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor }
  },
})

/**
 * The delivery route's single authorization query: a live, current-invitation guest session, this
 * album, the exact retained version and an allowed action. Returns the authoritative receipt, or
 * null for every denial so the route can answer with one uniform 404.
 */
export const forDelivery = query({
  args: { asset_id: v.string(), version_id: v.string(), action: vAction },
  returns: v.union(vStoredAsset, v.null()),
  handler: async (ctx, args) => {
    const workspace = getStorageWorkspace()
    if (!workspace || !(await findGuest(ctx))) return null
    const row = await ctx.runQuery(components.transloadit.lib.getStoredAsset, {
      workspace,
      assetId: args.asset_id,
      versionId: args.version_id,
    })
    if (!row || !(await findBoundUpload(ctx, row))) return null
    if (args.action === 'preview' && !(row.asset.width && row.asset.height)) return null
    return row.asset
  },
})
