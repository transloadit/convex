import type { StoredAsset } from '@transloadit/convex'
import type { StorageImageReceipt } from '@transloadit/viewer/react'

/** One private original plus its authorized video renditions, from `media:list`. */
export type StorageGalleryAsset = {
  id: string
  assemblyId: string
  asset: StoredAsset
  video?: StoredAsset
  poster?: StoredAsset
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
  receipt?: StorageImageReceipt
  original?: StoredAsset
  kind: 'image' | 'video'
  video?: StoredAsset
  poster?: StoredAsset
  aspectRatio?: number
  uploadedBy?: string
  createdAt?: number
}

// Photos, video playback, posters and downloads share the same authorized Storage route.
export const buildStorageGalleryItems = (
  assets: StorageGalleryAsset[],
  { now = Date.now(), retentionMs = galleryRetentionMs } = {},
): GalleryItem[] =>
  assets.flatMap(({ assemblyId, asset, video, poster, uploadedBy, createdAt }): GalleryItem[] => {
    const { width, height } = asset
    if (now - createdAt >= retentionMs) return []
    const base = {
      id: `${asset.asset_id}.${asset.version_id}`,
      assemblyId,
      name: asset.path.slice(asset.path.lastIndexOf('/') + 1),
      original: asset,
      uploadedBy,
      createdAt,
      aspectRatio: width && height ? width / height : undefined,
    }
    if (asset.mime?.startsWith('video/'))
      return [
        {
          ...base,
          kind: 'video',
          // Encoders can apply a phone's rotation metadata; size the card for playback.
          aspectRatio: video?.width && video.height ? video.width / video.height : base.aspectRatio,
          video,
          poster,
        },
      ]
    if (!asset.mime?.startsWith('image/') || !width || !height) return []
    return [
      {
        ...base,
        receipt: { ...asset, width, height },
        kind: 'image',
      },
    ]
  })

// Mirrors `.gallery` in globals.css: rows are --row-height tall (250px, or 150px up to 640px) and
// spare width grows each card in proportion to its ratio, measured below 1.25x on desktop. On
// narrow screens one photo can fill the row. Fixed sizes, never `auto`, keep the chosen candidate
// identical across gallery layout changes, so no larger rendition is requested.
export const thumbnailSizes = (aspectRatio = 3 / 2) =>
  `(max-width: 640px) 100vw, ${Math.round(250 * aspectRatio * 1.25)}px`
