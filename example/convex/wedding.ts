import { vAssemblyOptions } from '@transloadit/convex'
import { ConvexError, v } from 'convex/values'
import { album } from '../lib/album-access'
import { parseDisplayParams } from '../lib/assembly-params'
import { isValidGuestName } from '../lib/guest-name'
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

    if (!Number.isInteger(args.fileCount) || args.fileCount < 1 || args.fileCount > 12)
      throw new ConvexError('INVALID_FILE_COUNT')
    const fileCount = args.fileCount
    const guestName = args.guestName.trim()
    // Generated here, never by the browser: the upload ID also names its private Storage prefix.
    const uploadId = crypto.randomUUID()
    // Pause refuses new uploads; it must never make a private album silently write public media.
    if (process.env.TRANSLOADIT_STORAGE_UPLOADS_DISABLED === '1' || !getStorageWorkspace())
      throw new ConvexError('UPLOADS_UNAVAILABLE')
    const storagePrefix = getUploadStoragePrefix(uploadId)
    await ctx.runMutation(internal.wedding.beginUpload, {
      uploadId,
      userId: guest.userId,
      guestName,
      fileCount,
      storagePrefix,
    })

    const templateId = process.env.TRANSLOADIT_WEDDING_TEMPLATE_ID || undefined
    const steps = buildWeddingSteps({ storagePrefix, templateId })
    const notifyUrl = requireEnv('TRANSLOADIT_NOTIFY_URL')
    const assemblyArgs = {
      steps,
      ...(templateId ? { templateId } : {}),
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

// Compatibility for already-open clients from before the Storage-only demo. No public exports.
export const listGallery = query({
  args: { limit: v.optional(v.number()), createdAfter: v.optional(v.number()) },
  returns: v.array(v.null()),
  handler: async (ctx) => {
    await requireGuest(ctx)
    return []
  },
})
