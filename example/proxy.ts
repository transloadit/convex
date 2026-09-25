import { convexAuthNextjsMiddleware } from '@convex-dev/auth/nextjs/server'
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server'
import { getConvexUrl } from './lib/convex-url'

// Hosted albums keep Convex Auth tokens in httpOnly cookies, refreshed here, so server routes such
// as private media delivery can authorize the viewer. The local harness has no Convex deployment.
const sessionMaxAge = 30 * 24 * 60 * 60

let convexAuth: ReturnType<typeof convexAuthNextjsMiddleware> | undefined

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const convexUrl = getConvexUrl()
  if (!convexUrl) return NextResponse.next()
  convexAuth ??= convexAuthNextjsMiddleware(undefined, {
    convexUrl,
    cookieConfig: { maxAge: sessionMaxAge },
  })
  return convexAuth(request, event)
}

export const config = {
  // Pages and API routes, including /api/auth; never Next assets or public files.
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)'],
}
