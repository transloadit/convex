import { Anonymous } from '@convex-dev/auth/providers/Anonymous'
import { convexAuth } from '@convex-dev/auth/server'

const ensureConvexSiteUrl = () => {
  if (process.env.CONVEX_SITE_URL) return
  const convexUrl = process.env.CONVEX_URL
  if (!convexUrl) return
  if (!convexUrl.includes('.convex.cloud')) return
  process.env.CONVEX_SITE_URL = convexUrl.replace('.convex.cloud', '.convex.site')
}

ensureConvexSiteUrl()

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous],
})
