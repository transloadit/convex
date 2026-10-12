import { type StoredAsset, vStoredAsset, type vStoredAssetResponse } from '@transloadit/convex'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
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
  assemblyId: v.string(),
  asset: vStoredAsset,
  video: v.optional(vStoredAsset),
  poster: v.optional(vStoredAsset),
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

// Previews need image geometry. A ThumbHash is preview pixels too: versions that only allow
// originals never send it, from either query.
const canPreview = (asset: StoredAsset) =>
  Boolean(asset.mime?.startsWith('image/') && asset.width && asset.height)
const authorizedReceipt = (asset: StoredAsset) => {
  if (canPreview(asset)) return asset
  const { thumbhash: _thumbhash, ...receipt } = asset
  return receipt
}

/**
 * Newest private originals for admitted guests: canonical receipts, never URLs or credentials.
 * Pages keep the component's cursors and split signals, which usePaginatedQuery from
 * convex-helpers uses to keep loaded pages stable in a live album.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vGalleryAsset),
  handler: async (ctx, args) => {
    await requireGuest(ctx)
    const result = await ctx.runQuery(components.transloadit.lib.listStoredAssets, {
      album,
      paginationOpts: args.paginationOpts,
    })
    const page = []
    const assemblies = new Map<string, StoredAssetRow[]>()
    for (const row of result.page) {
      // Keep old private photos readable. Renditions are attached to their original rather than
      // becoming separate gallery cards or depending on which pagination page they land on.
      // /transloadit/store publishes under the producer, not the store Step's name.
      if (row.stepName !== ':original' && row.stepName !== 'images_filtered') continue
      const upload = await findBoundUpload(ctx, row)
      if (!upload) continue
      let video: StoredAsset | undefined
      let poster: StoredAsset | undefined
      if (row.asset.mime?.startsWith('video/')) {
        let siblings = assemblies.get(row.assemblyId)
        if (!siblings) {
          siblings = await ctx.runQuery(components.transloadit.lib.listStoredAssetsForAssembly, {
            assemblyId: row.assemblyId,
            limit: 500,
          })
          assemblies.set(row.assemblyId, siblings)
        }
        const sourceId = singleOriginalId(row.originalId)
        for (const sibling of siblings) {
          if (
            !sourceId ||
            singleOriginalId(sibling.originalId) !== sourceId ||
            sibling.uploadId !== row.uploadId ||
            sibling.album !== upload.album ||
            sibling.userId !== upload.userId ||
            !upload.storagePrefix ||
            !isInUploadStoragePrefix(sibling.asset.path, upload.storagePrefix)
          )
            continue
          if (sibling.stepName === 'video_encode' && sibling.asset.mime === 'video/mp4')
            video = authorizedReceipt(sibling.asset)
          if (sibling.stepName === 'video_poster' && canPreview(sibling.asset))
            poster = authorizedReceipt(sibling.asset)
        }
      }
      const { workspace, asset_id, version_id } = row.asset
      page.push({
        id: `${workspace}:${asset_id}:${version_id}`,
        assemblyId: row.assemblyId,
        asset: authorizedReceipt(row.asset),
        ...(video ? { video } : {}),
        ...(poster ? { poster } : {}),
        uploadedBy: upload.guestName,
        createdAt: row.createdAt,
      })
    }
    return { ...result, page }
  },
})

// Filenames are not identities, and a multi-input rendition cannot name one original safely.
const singleOriginalId = (id: StoredAssetRow['originalId']) =>
  typeof id === 'string' ? id : id?.length === 1 ? (id[0] ?? undefined) : undefined

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
    if (args.action === 'preview' && !canPreview(row.asset)) return null
    return authorizedReceipt(row.asset)
  },
})
