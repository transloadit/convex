import { NextResponse } from 'next/server'
import { runAction, runQuery } from '../../../lib/convex'
import { isValidGuestName } from '../../../lib/guest-name'
import { isSameOrigin, localAccessDenied, readLocalGuest } from '../../../lib/local-session'
import { getUploadErrorCode } from '../../../lib/upload-errors'

export async function POST(request: Request) {
  const guest = await readLocalGuest()
  if (!guest || !isSameOrigin(request)) return localAccessDenied()
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as {
    fileCount?: number
    guestName?: string
  }
  const fileCount = Number.isFinite(payload.fileCount) ? Math.max(1, payload.fileCount ?? 1) : 1
  if (!isValidGuestName(payload.guestName)) {
    return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
  }
  try {
    const response = await runAction('createWeddingAssemblyOptions', {
      fileCount,
      guestName: payload.guestName.trim(),
      userId: guest.userId,
    })
    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json({ error: getUploadErrorCode(error) }, { status: 400 })
  }
}

export async function GET(request: Request) {
  const guest = await readLocalGuest()
  if (!guest) return localAccessDenied()
  const url = new URL(request.url)
  const assemblyId = url.searchParams.get('assemblyId')
  if (!assemblyId) {
    return NextResponse.json({ status: null, results: [] })
  }

  if (url.searchParams.get('refresh') === '1') {
    try {
      await runAction('refreshAssembly', { assemblyId, userId: guest.userId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('Refresh assembly failed', message)
    }
  }

  const [status, results] = await Promise.all([
    runQuery('getAssemblyStatus', { assemblyId, userId: guest.userId }),
    runQuery('listResults', { assemblyId, userId: guest.userId }),
  ])

  return NextResponse.json({ status, results }, { headers: { 'Cache-Control': 'no-store' } })
}
