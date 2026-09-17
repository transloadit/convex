import { getAuthSessionId, getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { getInviteCode, inviteVersion } from '../lib/album-access'
import { internalMutation, internalQuery, type QueryCtx, query } from './_generated/server'

export const settings = query({
  args: {},
  returns: v.object({ requiresInviteCode: v.boolean() }),
  handler: () => ({ requiresInviteCode: Boolean(getInviteCode()) }),
})

export const admit = internalMutation({
  args: { userId: v.id('users'), name: v.string(), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('albumGuests')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .unique()
    if (existing) await ctx.db.patch(existing._id, args)
    else await ctx.db.insert('albumGuests', args)
    return null
  },
})

export const findGuest = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx)
  const sessionId = await getAuthSessionId(ctx)
  if (!userId || !sessionId) return null
  const session = await ctx.db.get(sessionId)
  if (!session || session.userId !== userId || session.expirationTime <= Date.now()) return null
  const guest = await ctx.db
    .query('albumGuests')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()
  // Changing (or enabling) the invitation code requires guests to enter the current code again.
  if (!guest || guest.version !== (await inviteVersion())) return null
  return { userId, name: guest.name }
}

export const requireGuest = async (ctx: QueryCtx) => {
  const guest = await findGuest(ctx)
  if (!guest) throw new ConvexError('ACCESS_REQUIRED')
  return guest
}

export const viewer = query({
  args: {},
  returns: v.union(v.object({ userId: v.id('users'), name: v.string() }), v.null()),
  handler: findGuest,
})

export const requireViewer = internalQuery({
  args: {},
  returns: v.object({ userId: v.id('users'), name: v.string() }),
  handler: requireGuest,
})
