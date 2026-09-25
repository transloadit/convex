import {
  type AssemblyResultResponse,
  vAssemblyOptions,
  vAssemblyResultResponse,
} from '@transloadit/convex'
import { ConvexError, v } from 'convex/values'
import { album } from '../lib/album-access'
import { parseDisplayParams } from '../lib/assembly-params'
import { isGalleryResultStep } from '../lib/gallery-steps'
import { getGuestName, isValidGuestName } from '../lib/guest-name'
import { getStorageWorkspace, getUploadStoragePrefix } from '../lib/storage'
import { buildWeddingSteps } from '../lib/transloadit-steps'
import { components, internal } from './_generated/api'
import { action, internalMutation, type MutationCtx, query } from './_generated/server'
import { requireGuest } from './guests'

const MAX_UPLOADS_PER_HOUR = 6
const WINDOW_MS = 60 * 60 * 1000

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} environment variable`)
  }
  return value
}

const checkUploadLimit = async (ctx: MutationCtx, args: { userId: string }) => {
  const now = Date.now()
  const existing = await ctx.db
    .query('uploadLimits')
    .withIndex('by_user', (q) => q.eq('userId', args.userId))
    .first()
  if (!existing) {
    await ctx.db.insert('uploadLimits', {
      userId: args.userId,
      windowStart: now,
      count: 1,
      lastUploadAt: now,
    })
    return null
  }
  if (now - existing.windowStart > WINDOW_MS) {
    await ctx.db.patch(existing._id, {
      windowStart: now,
      count: 1,
      lastUploadAt: now,
    })
    return null
  }
  if (existing.count >= MAX_UPLOADS_PER_HOUR) {
    throw new ConvexError('UPLOAD_LIMIT')
  }
  await ctx.db.patch(existing._id, {
    count: existing.count + 1,
    lastUploadAt: now,
  })
  return null
}

// Consumes the upload limit and records the upload before any Assembly parameters are signed.
export const beginUpload = internalMutation({
  args: {
    uploadId: v.string(),
    userId: v.string(),
    guestName: v.string(),
    fileCount: v.number(),
    storagePrefix: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await checkUploadLimit(ctx, { userId: args.userId })
    await ctx.db.insert('uploads', { ...args, album, createdAt: Date.now() })
    return null
  },
})

export const createWeddingAssemblyOptions = action({
  args: {
    fileCount: v.number(),
    guestName: v.string(),
  },
  returns: v.object({
    assemblyOptions: vAssemblyOptions,
    params: v.any(),
  }),
  handler: async (ctx, args) => {
    const guest = await ctx.runQuery(internal.guests.requireViewer, {})

    if (!isValidGuestName(args.guestName)) throw new ConvexError('NAME_REQUIRED')

    const fileCount = Math.max(1, args.fileCount)
    const guestName = args.guestName.trim()
    // Generated here, never by the browser: the upload ID also names its private Storage prefix.
    const uploadId = crypto.randomUUID()
    // Roll back only new uploads; keep the Workspace configured for retained private receipts.
    const storagePrefix =
      process.env.TRANSLOADIT_STORAGE_UPLOADS_DISABLED !== '1' && getStorageWorkspace()
        ? getUploadStoragePrefix(uploadId)
        : undefined
    await ctx.runMutation(internal.wedding.beginUpload, {
      uploadId,
      userId: guest.userId,
      guestName,
      fileCount,
      storagePrefix,
    })

    const steps = buildWeddingSteps({ storagePrefix })
    const notifyUrl = requireEnv('TRANSLOADIT_NOTIFY_URL')
    const assemblyArgs = {
      steps,
      notifyUrl,
      numExpectedUploadFiles: fileCount,
      fields: {
        guestName,
        album,
        fileCount,
        userId: guest.userId,
        uploadId,
      },
      userId: guest.userId,
    }

    const assemblyOptions = await ctx.runAction(components.transloadit.lib.createAssemblyOptions, {
      ...assemblyArgs,
      config: {
        authKey: requireEnv('TRANSLOADIT_KEY'),
        authSecret: requireEnv('TRANSLOADIT_SECRET'),
      },
    })

    const params = parseDisplayParams(assemblyOptions.params)

    return {
      assemblyOptions,
      params,
    }
  },
})

// Names are persisted in each Assembly's signed fields. Join only the display name, rather than
// exposing arbitrary Assembly fields or copying wedding-specific metadata into the component.
export const listGallery = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({ ...vAssemblyResultResponse.fields, uploadedBy: v.optional(v.string()) }),
  ),
  handler: async (ctx, args) => {
    await requireGuest(ctx)
    // Only the R2 renditions the gallery renders: Storage receipts (with their ThumbHash) are
    // served by media:list after binding checks, never by this legacy result path.
    const results: AssemblyResultResponse[] = (
      await ctx.runQuery(components.transloadit.lib.listAlbumResults, {
        album,
        limit: args.limit ?? 80,
      })
    ).filter((result: AssemblyResultResponse) => isGalleryResultStep(result.stepName))
    const names = new Map(
      await Promise.all(
        [...new Set(results.map((result) => result.assemblyId))].map(async (assemblyId) => {
          const assembly = await ctx.runQuery(components.transloadit.lib.getAssemblyStatus, {
            assemblyId,
          })
          return [assemblyId, getGuestName(assembly?.fields?.guestName)] as const
        }),
      ),
    )
    return results.map((result) => ({ ...result, uploadedBy: names.get(result.assemblyId) }))
  },
})
