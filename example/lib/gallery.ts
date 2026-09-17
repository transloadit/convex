import { type AssemblyResultResponse, getResultOriginalKey } from './transloadit'

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
  url: string
  kind: 'image' | 'video'
  posterUrl?: string
}

const steps = {
  images_resized: { kind: 'image', stored: false },
  images_output: { kind: 'image', stored: true },
  videos_encoded: { kind: 'video', stored: false },
  videos_output: { kind: 'video', stored: true },
  videos_thumbs: { kind: 'poster', stored: false },
  videos_thumbs_output: { kind: 'poster', stored: true },
} as const

// Keep Assembly/result shapes at the boundary so the viewer can also consume Storage assets.
export const buildGalleryItems = (
  results: AssemblyResultResponse[],
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
        name: result.name ?? 'Wedding moment',
        url: result.sslUrl,
        kind: step.kind,
      },
    })
  }

  return [...media.values()].map(({ item }) => ({
    ...item,
    posterUrl:
      item.kind === 'video' ? posters.get(item.id.slice(0, -':video'.length))?.url : undefined,
  }))
}
