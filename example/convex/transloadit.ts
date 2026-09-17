import { vAssemblyResponse, vAssemblyResultResponse } from '@transloadit/convex'
import { v } from 'convex/values'
import { album } from '../lib/album-access'
import { getGuestName } from '../lib/guest-name'
import { components, internal } from './_generated/api'
import { action, internalAction, internalMutation, type QueryCtx, query } from './_generated/server'
import { requireGuest } from './guests'

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const ownedAssembly = async (ctx: QueryCtx, assemblyId: string) => {
  const guest = await requireGuest(ctx)
  const assembly = await ctx.runQuery(components.transloadit.lib.getAssemblyStatus, { assemblyId })
  return assembly?.fields?.album === album && assembly.fields.userId === guest.userId
    ? assembly
    : null
}

export const getAssemblyStatus = query({
  args: { assemblyId: v.string() },
  returns: v.union(vAssemblyResponse, v.null()),
  handler: (ctx, { assemblyId }) => ownedAssembly(ctx, assemblyId),
})

export const listResults = query({
  args: { assemblyId: v.string(), limit: v.optional(v.number()), stepName: v.optional(v.string()) },
  returns: v.array(vAssemblyResultResponse),
  handler: async (ctx, args) => {
    if (!(await ownedAssembly(ctx, args.assemblyId))) return []
    return ctx.runQuery(components.transloadit.lib.listResults, args)
  },
})

export const listAssemblies = query({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(vAssemblyResponse),
  handler: async (ctx, args) => {
    await requireGuest(ctx)
    const assemblies = await ctx.runQuery(components.transloadit.lib.listAssemblies, args)
    // Shared activity only needs attribution and counts, not other guests' raw upload metadata.
    return assemblies
      .filter((assembly) => assembly.fields?.album === album)
      .map((assembly) => ({
        _id: assembly._id,
        _creationTime: assembly._creationTime,
        assemblyId: assembly.assemblyId,
        status: assembly.status,
        createdAt: assembly.createdAt,
        updatedAt: assembly.updatedAt,
        fields: {
          guestName: getGuestName(assembly.fields?.guestName),
          fileCount:
            typeof assembly.fields?.fileCount === 'number' ? assembly.fields.fileCount : undefined,
        },
      }))
  },
})

export const refreshAssembly = action({
  args: { assemblyId: v.string() },
  handler: async (ctx, args) => {
    const guest = await ctx.runQuery(internal.guests.requireViewer, {})
    return ctx.runAction(components.transloadit.lib.refreshAssembly, {
      ...args,
      expectedFields: { album, userId: guest.userId },
      config: {
        authKey: requireEnv('TRANSLOADIT_KEY'),
        authSecret: requireEnv('TRANSLOADIT_SECRET'),
      },
    })
  },
})

// Only the verified webhook HTTP route can enqueue payloads. No guest-facing ingestion API.
export const queueWebhook = internalAction({
  args: { payload: v.any(), rawBody: v.optional(v.string()), signature: v.optional(v.string()) },
  handler: (ctx, args) =>
    ctx.runAction(components.transloadit.lib.queueWebhook, {
      ...args,
      config: { authSecret: requireEnv('TRANSLOADIT_SECRET') },
    }),
})

// The cleanup script uses admin authentication; guests must never be able to purge an album.
export const purgeAlbum = internalMutation({
  args: { album: v.string(), deleteAssemblies: v.optional(v.boolean()) },
  handler: (ctx, args) => ctx.runMutation(components.transloadit.lib.purgeAlbum, args),
})
