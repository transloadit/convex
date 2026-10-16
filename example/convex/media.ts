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

// Originals are stored straight from :original and Uppy restricts types only in the browser, so
// other uploaded files are kept until expiry but never listed or delivered.
const isMedia = (asset: StoredAsset) => /^(image|video)\//.test(asset.mime ?? '')

// A receipt's signed fields name an upload; it counts only when that server-created upload is in
// this album, belongs to the same guest and reserved the prefix the file was written to.
const findBoundUpload = async (ctx: QueryCtx, row: StoredAssetRow) => {
  if (row.album !== album || !row.uploadId || !row.userId || !isMedia(row.asset)) return null
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

const galleryAsset = async (
  ctx: QueryCtx,
  row: StoredAssetRow,
  renditions: Record<string, StoredAssetRow | undefined>,
) => {
  const upload = await findBoundUpload(ctx, row)
  if (!upload) return null
  let video: StoredAsset | undefined
  let poster: StoredAsset | undefined
  if (row.asset.mime?.startsWith('video/')) {
    // The component groups provenance; current access and safe upload paths remain app policy.
    const playback = renditions.playback
    if (playback?.asset.mime === 'video/mp4' && (await findBoundUpload(ctx, playback)))
      video = authorizedReceipt(playback.asset)
    const preview = renditions.poster
    if (preview && canPreview(preview.asset) && (await findBoundUpload(ctx, preview)))
      poster = authorizedReceipt(preview.asset)
  }
  const { workspace, asset_id, version_id } = row.asset
  return {
    id: `${workspace}:${asset_id}:${version_id}`,
    assemblyId: row.assemblyId,
    asset: authorizedReceipt(row.asset),
    ...(video ? { video } : {}),
    ...(poster ? { poster } : {}),
    uploadedBy: upload.guestName,
    createdAt: row.createdAt,
  }
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
    const result = await ctx.runQuery(components.transloadit.lib.listStoredMedia, {
      album,
      // Keep old private photos readable alongside direct originals, without a data migration.
      originalSteps: [':original', 'images_filtered'],
      renditions: { playback: 'video_encode', poster: 'video_poster' },
      paginationOpts: args.paginationOpts,
    })
    const page = []
    for (const { original: row, renditions } of result.page) {
      const item = await galleryAsset(ctx, row, renditions)
      if (item) page.push(item)
    }
    return { ...result, page }
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
    if (args.action === 'preview' && !canPreview(row.asset)) return null
    return authorizedReceipt(row.asset)
  },
})

/** Resolve a shared exact-version link without walking every page of the album. */
export const get = query({
  args: { assetId: v.string(), versionId: v.string() },
  returns: v.union(vGalleryAsset, v.null()),
  handler: async (ctx, args) => {
    const workspace = getStorageWorkspace()
    if (!workspace || !(await findGuest(ctx))) return null
    const row = await ctx.runQuery(components.transloadit.lib.getStoredAsset, {
      workspace,
      ...args,
    })
    if (
      !row ||
      ![':original', 'images_filtered'].includes(row.stepName) ||
      !(await findBoundUpload(ctx, row))
    )
      return null
    if (!row.asset.mime?.startsWith('video/')) return galleryAsset(ctx, row, {})
    // This app signs batches of at most 12 uploads with three stored outputs per video. Reuse
    // the component's bounded Assembly lookup; custom/ambiguous excess results fail closed.
    const siblings = await ctx.runQuery(components.transloadit.lib.listStoredAssetsForAssembly, {
      assemblyId: row.assemblyId,
      limit: 500,
    })
    if (siblings.length === 500) return null
    const sourceId = (id: StoredAssetRow['originalId']) =>
      typeof id === 'string' ? id : id?.length === 1 ? id[0] : undefined
    const original = sourceId(row.originalId)
    const rendition = (step: string) => {
      if (!original) return undefined
      const matches = siblings.filter(
        (item) =>
          item.stepName === step &&
          sourceId(item.originalId) === original &&
          item.album === row.album &&
          item.userId === row.userId &&
          item.uploadId === row.uploadId &&
          item.asset.workspace === workspace,
      )
      return matches.length === 1 ? matches[0] : undefined
    }
    return galleryAsset(ctx, row, {
      playback: rendition('video_encode'),
      poster: rendition('video_poster'),
    })
  },
})
