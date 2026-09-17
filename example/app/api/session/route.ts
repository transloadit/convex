import { NextResponse } from 'next/server'
import { getInviteCode, validateEntry } from '../../../lib/album-access'
import {
  createLocalSession,
  isLocalAlbum,
  isSameOrigin,
  localAccessDenied,
  readLocalGuest,
  removeLocalSession,
  sessionCookie,
  sessionMaxAge,
} from '../../../lib/local-session'
import { getUploadErrorCode } from '../../../lib/upload-errors'

export async function GET() {
  if (!isLocalAlbum()) return localAccessDenied()
  return NextResponse.json(
    { guest: await readLocalGuest(), requiresInviteCode: Boolean(getInviteCode()) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  if (!isLocalAlbum() || !isSameOrigin(request)) return localAccessDenied()
  try {
    const payload = await request.json()
    const name = validateEntry(payload?.guestName, payload?.uploadCode)
    const { token, guest } = await createLocalSession(name)
    const response = NextResponse.json({ guest }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: sessionMaxAge,
    })
    return response
  } catch (error) {
    return NextResponse.json({ error: getUploadErrorCode(error) }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  if (!isLocalAlbum() || !isSameOrigin(request)) return localAccessDenied()
  await removeLocalSession()
  const response = NextResponse.json({ guest: null }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.delete(sessionCookie)
  return response
}
