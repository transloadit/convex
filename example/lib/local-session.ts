import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { inviteVersion } from './album-access'

export type AlbumGuest = { userId: string; name: string }
type Session = AlbumGuest & { version: string; expiresAt: number }
const state = globalThis as typeof globalThis & { __albumSessions?: Map<string, Session> }
state.__albumSessions ??= new Map<string, Session>()
const sessions = state.__albumSessions
export const sessionCookie = 'wedding_session'
export const sessionMaxAge = 30 * 24 * 60 * 60

// The in-memory harness is for local development/testing only. Hosted albums use Convex Auth.
export const isLocalAlbum = () =>
  !process.env.VERCEL_ENV &&
  (process.env.E2E_MODE === 'local' ||
    (process.env.E2E_MODE !== 'cloud' &&
      !process.env.NEXT_PUBLIC_CONVEX_URL &&
      !process.env.CONVEX_URL &&
      !process.env.E2E_REMOTE_URL))

export const readLocalGuest = async () => {
  if (!isLocalAlbum()) return null
  const token = (await cookies()).get(sessionCookie)?.value
  const session = token ? sessions.get(token) : undefined
  if (!session || session.expiresAt <= Date.now() || session.version !== (await inviteVersion()))
    return null
  return { userId: session.userId, name: session.name }
}

export const createLocalSession = async (name: string) => {
  for (const [token, session] of sessions)
    if (session.expiresAt <= Date.now()) sessions.delete(token)
  const token = crypto.randomUUID()
  const guest = { userId: crypto.randomUUID(), name }
  sessions.set(token, {
    ...guest,
    version: await inviteVersion(),
    expiresAt: Date.now() + sessionMaxAge * 1000,
  })
  return { token, guest }
}

export const removeLocalSession = async () => {
  const token = (await cookies()).get(sessionCookie)?.value
  if (token) sessions.delete(token)
}

export const localAccessDenied = () =>
  NextResponse.json(
    { error: 'ACCESS_REQUIRED' },
    { status: isLocalAlbum() ? 401 : 404, headers: { 'Cache-Control': 'no-store' } },
  )

export const isSameOrigin = (request: Request) => {
  const url = new URL(request.url)
  // Next can normalize request.url to localhost even when the browser uses 127.0.0.1.
  const host = request.headers.get('host') ?? url.host
  return request.headers.get('origin') === `${url.protocol}//${host}`
}
