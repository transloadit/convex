import {
  type AssemblyResultResponse,
  vAssemblyOptions,
  vAssemblyResultResponse,
} from '@transloadit/convex'
import { ConvexError, v } from 'convex/values'
import { album } from '../lib/album-access'
import { parseDisplayParams } from '../lib/assembly-params'
import { getGuestName, isValidGuestName } from '../lib/guest-name'
import { buildWeddingSteps } from '../lib/transloadit-steps'
import { components, internal } from './_generated/api'
import { action, internalMutation, query } from './_generated/server'
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

export const checkUploadLimit = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
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

    await ctx.runMutation(internal.wedding.checkUploadLimit, {
      userId: guest.userId,
    })

    const steps = buildWeddingSteps()
    const notifyUrl = requireEnv('TRANSLOADIT_NOTIFY_URL')
    const fileCount = Math.max(1, args.fileCount)
    const assemblyArgs = {
      steps,
      notifyUrl,
      numExpectedUploadFiles: fileCount,
      fields: {
        guestName: args.guestName.trim(),
        album,
        fileCount,
        userId: guest.userId,
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
    const results: AssemblyResultResponse[] = await ctx.runQuery(
      components.transloadit.lib.listAlbumResults,
      {
        album,
        limit: args.limit ?? 80,
      },
    )
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
