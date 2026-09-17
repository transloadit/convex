import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { convexAuth, createAccount } from '@convex-dev/auth/server'
import { inviteVersion, validateEntry } from '../lib/album-access'
import { internal } from './_generated/api'

const ensureConvexSiteUrl = () => {
  if (process.env.CONVEX_SITE_URL) return
  const convexUrl = process.env.CONVEX_URL
  if (!convexUrl) return
  if (!convexUrl.includes('.convex.cloud')) return
  process.env.CONVEX_SITE_URL = convexUrl.replace('.convex.cloud', '.convex.site')
}

ensureConvexSiteUrl()

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: 'guest',
      authorize: async (credentials, ctx) => {
        const name = validateEntry(credentials.guestName, credentials.uploadCode)
        // A display name is not an account identifier: two guests named Alex get distinct sessions.
        const { user } = await createAccount(ctx, {
          provider: 'guest',
          account: { id: crypto.randomUUID() },
          profile: { name, isAnonymous: true },
        })
        await ctx.runMutation(internal.guests.admit, {
          userId: user._id,
          name,
          version: await inviteVersion(),
        })
        return { userId: user._id }
      },
    }),
  ],
})
