import type { StoredAsset } from '@transloadit/convex'
import type { StorageImageReceipt } from '@transloadit/viewer/react'
import { galleryResultSteps } from './gallery-steps'
import { type AssemblyResultResponse, getResultOriginalKey } from './transloadit'

export type GalleryResult = AssemblyResultResponse & { uploadedBy?: string }

/** One private Storage photo from `media:list`: a canonical receipt, never a URL. */
export type StorageGalleryAsset = {
  id: string
  assemblyId: string
  asset: StoredAsset
  uploadedBy: string
  createdAt: number
}

const retentionHours = Number.parseFloat(process.env.NEXT_PUBLIC_GALLERY_RETENTION_HOURS ?? '24')
export const galleryRetentionMs =
  Number.isFinite(retentionHours) && retentionHours > 0
    ? retentionHours * 60 * 60 * 1000
    : Number.POSITIVE_INFINITY
export const galleryRetentionLabel = Number.isFinite(galleryRetentionMs)
  ? `${retentionHours}h`
  : 'all time'

export type GalleryItem = {
  id: string
  assemblyId?: string
  name: string
  /** Public R2 rendition. Private Storage photos carry a receipt instead. */
  url?: string
  receipt?: StorageImageReceipt
  kind: 'image' | 'video'
  posterUrl?: string
  aspectRatio?: number
  uploadedBy?: string
  createdAt?: number
}

const getAspectRatio = (raw: unknown) => {
  if (!raw || typeof raw !== 'object' || !('meta' in raw)) return undefined
  const meta = raw.meta
  if (!meta || typeof meta !== 'object' || !('width' in meta) || !('height' in meta))
    return undefined
  const { width, height } = meta
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0)
    return undefined
  const ratio = width / height
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
}

const steps = galleryResultSteps

// Keep Assembly/result shapes at the boundary so the viewer can also consume Storage assets.
export const buildGalleryItems = (
  results: GalleryResult[],
  { now = Date.now(), retentionMs = galleryRetentionMs } = {},
): GalleryItem[] => {
  const media = new Map<string, { item: GalleryItem; stored: boolean }>()
  const posters = new Map<string, { url: string; stored: boolean }>()

  for (const result of results) {
    if (typeof result.createdAt === 'number' && now - result.createdAt >= retentionMs) continue
    const step = steps[result.stepName as keyof typeof steps]
    if (!step || !result.sslUrl) continue
    // Names/basenames are not identities: two guests can upload IMG_0001.jpg in one batch.
    // Without source metadata, preserve each result rather than silently hiding an upload.
    const sourceId = getResultOriginalKey(result, { allowNameFallback: false })
    const original = `${result.assemblyId}:${sourceId ?? `result-${result.resultId ?? result._id}`}`
    if (step.kind === 'poster') {
      if (!posters.has(original) || step.stored) {
        posters.set(original, { url: result.sslUrl, stored: step.stored })
      }
      continue
    }
    const id = `${original}:${step.kind}`
    const existing = media.get(id)
    if (existing?.stored || (existing && !step.stored)) continue
    media.set(id, {
      stored: step.stored,
      item: {
        id,
        assemblyId: result.assemblyId,
        name: result.name ?? '',
        url: result.sslUrl,
        kind: step.kind,
        aspectRatio: getAspectRatio(result.raw),
        uploadedBy: result.uploadedBy,
        createdAt: result.createdAt,
      },
    })
  }

  return [...media.values()].map(({ item }) => ({
    ...item,
    posterUrl:
      item.kind === 'video' ? posters.get(item.id.slice(0, -':video'.length))?.url : undefined,
  }))
}

// Private photos render from their receipt through the authorized media route.
export const buildStorageGalleryItems = (
  assets: StorageGalleryAsset[],
  { now = Date.now(), retentionMs = galleryRetentionMs } = {},
): GalleryItem[] =>
  assets.flatMap(({ id, assemblyId, asset, uploadedBy, createdAt }) => {
    const { width, height } = asset
    if (now - createdAt >= retentionMs || !width || !height) return []
    return [
      {
        id: `storage:${id}`,
        assemblyId,
        name: asset.path.slice(asset.path.lastIndexOf('/') + 1),
        receipt: { ...asset, width, height },
        kind: 'image' as const,
        aspectRatio: width / height,
        uploadedBy,
        createdAt,
      },
    ]
  })

/** Newest first across private photos and R2 media; equal times keep their incoming order. */
export const mergeGalleryItems = (...lists: GalleryItem[][]) =>
  lists.flat().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

// Mirrors `.gallery` in globals.css: rows are --row-height tall (250px, or 150px up to 640px) and
// spare width grows each card in proportion to its ratio, measured below 1.25x on desktop. On
// narrow screens one photo can fill the row. Fixed sizes, never `auto`, keep the chosen candidate
// identical when opening the viewer remounts thumbnails, so no larger rendition is requested.
export const thumbnailSizes = (aspectRatio = 3 / 2) =>
  `(max-width: 640px) 100vw, ${Math.round(250 * aspectRatio * 1.25)}px`
