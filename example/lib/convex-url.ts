// One deployment URL for the browser client, the auth proxy and server-side authorization.
export const getConvexUrl = () =>
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || undefined
