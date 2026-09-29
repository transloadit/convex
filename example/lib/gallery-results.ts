import type { AssemblyResultResponse } from '@transloadit/convex'
import { type Infer, v } from 'convex/values'

// What the R2 gallery renders from a result: its rendition, credited guest, and from the raw
// result only the source ID and dimensions. Other result metadata stays on the server.
export const vGalleryResult = v.object({
  _id: v.string(),
  assemblyId: v.string(),
  stepName: v.string(),
  resultId: v.optional(v.string()),
  sslUrl: v.optional(v.string()),
  name: v.optional(v.string()),
  createdAt: v.number(),
  uploadedBy: v.optional(v.string()),
  raw: v.object({
    original_id: v.optional(v.union(v.string(), v.array(v.string()))),
    meta: v.optional(v.object({ width: v.optional(v.number()), height: v.optional(v.number()) })),
  }),
})

export type GalleryResult = Infer<typeof vGalleryResult>

const asRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const asNumber = (value: unknown) => (typeof value === 'number' ? value : undefined)

// Values `buildGalleryItems` would ignore are dropped, so projected results build the same items.
export const toGalleryResult = (
  result: AssemblyResultResponse,
  uploadedBy?: string,
): GalleryResult => {
  const raw = asRecord(result.raw)
  const originalId = raw?.original_id
  const meta = asRecord(raw?.meta)
  return {
    _id: result._id,
    assemblyId: result.assemblyId,
    stepName: result.stepName,
    resultId: result.resultId,
    sslUrl: result.sslUrl,
    name: result.name,
    createdAt: result.createdAt,
    uploadedBy,
    raw: {
      original_id:
        typeof originalId === 'string' ||
        (Array.isArray(originalId) && originalId.every((id) => typeof id === 'string'))
          ? originalId
          : undefined,
      meta: meta && { width: asNumber(meta.width), height: asNumber(meta.height) },
    },
  }
}
