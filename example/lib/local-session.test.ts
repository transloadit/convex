// @vitest-environment node

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GET as readAssemblies, POST as upload } from '../app/api/assemblies/route'
import { POST as enter, DELETE as leave, GET as viewer } from '../app/api/session/route'
import { runAction } from './convex'
import { isSameOrigin, sessionCookie } from './local-session'

const jar = vi.hoisted(() => new Map<string, string>())
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => ({ value: jar.get(name) }) }),
}))
vi.mock('./convex', () => ({ runAction: vi.fn(), runQuery: vi.fn() }))

const request = (body: Record<string, unknown>, origin = 'https://album.test') =>
  new Request('https://album.test/api/session', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jar.clear()
  vi.clearAllMocks()
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('E2E_MODE', 'local')
  vi.stubEnv('WEDDING_UPLOAD_CODE', 'invitation-test')
})
afterEach(() => vi.unstubAllEnvs())

test('local album endpoints deny missing and forged sessions before accessing data', async () => {
  for (const token of ['', 'forged-cookie']) {
    jar.set(sessionCookie, token)
    expect((await readAssemblies(new Request('https://album.test/api/assemblies'))).status).toBe(
      401,
    )
    expect((await upload(request({ guestName: 'Alex' }))).status).toBe(401)
  }
  expect(runAction).not.toHaveBeenCalled()
})

test('login checks the name/code, keeps the code out of the response, and revokes a copied cookie on logout', async () => {
  expect(await (await viewer()).json()).toEqual({ guest: null, requiresInviteCode: true })
  for (const [params, error] of [
    [{ guestName: ' ', uploadCode: 'invitation-test' }, 'NAME_REQUIRED'],
    [{ guestName: 'Alex' }, 'INVITE_REQUIRED'],
    [{ guestName: 'Alex', uploadCode: 'wrong' }, 'INVITE_REQUIRED'],
  ] as const) {
    const response = await enter(request(params))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
    expect(response.headers.get('set-cookie')).toBeNull()
  }
  const response = await enter(request({ guestName: '  Олена  ', uploadCode: 'invitation-test' }))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toEqual({ guest: { name: 'Олена', userId: expect.any(String) } })
  expect(JSON.stringify(body)).not.toContain('invitation-test')
  const cookie = response.cookies.get(sessionCookie)
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true })
  jar.set(sessionCookie, cookie?.value ?? '')
  expect(await (await viewer()).json()).toMatchObject(body)
  vi.mocked(runAction).mockResolvedValue({ assemblyOptions: {} })
  expect(
    (await upload(request({ guestName: '  Another Guest  ', userId: 'forged-id' }))).status,
  ).toBe(200)
  expect(runAction).toHaveBeenCalledWith('createWeddingAssemblyOptions', {
    guestName: 'Another Guest',
    userId: body.guest.userId,
    fileCount: 1,
  })
  expect((await leave(request({}))).status).toBe(200)
  // The copied cookie stays in the mock browser; deleting only its Set-Cookie would not pass.
  expect(await (await viewer()).json()).toMatchObject({ guest: null })
  expect((await upload(request({ guestName: 'Alex' }))).status).toBe(401)
})

test('a code is optional, but enabling it revokes a previous name-only session', async () => {
  vi.stubEnv('WEDDING_UPLOAD_CODE', '')
  expect(await (await viewer()).json()).toEqual({ guest: null, requiresInviteCode: false })
  const response = await enter(request({ guestName: 'Alex' }))
  expect(response.status).toBe(200)
  jar.set(sessionCookie, response.cookies.get(sessionCookie)?.value ?? '')
  expect(await (await viewer()).json()).toMatchObject({ guest: { name: 'Alex' } })
  vi.stubEnv('WEDDING_UPLOAD_CODE', 'new-invitation')
  expect(await (await viewer()).json()).toEqual({ guest: null, requiresInviteCode: true })
})

test('local session creation/logout reject other origins, and hosted deployments disable the harness', async () => {
  expect(
    isSameOrigin(
      new Request('http://localhost:3000/api/session', {
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
      }),
    ),
  ).toBe(true)
  expect(
    isSameOrigin(
      new Request('http://localhost:3000/api/session', {
        headers: { host: '127.0.0.1:3000', origin: 'http://localhost:3000' },
      }),
    ),
  ).toBe(false)
  expect(
    (
      await enter(
        request({ guestName: 'Alex', uploadCode: 'invitation-test' }, 'https://other.test'),
      )
    ).status,
  ).toBe(401)
  expect((await leave(request({}, 'https://other.test'))).status).toBe(401)
  vi.stubEnv('VERCEL_ENV', 'preview')
  expect((await enter(request({ guestName: 'Alex', uploadCode: 'invitation-test' }))).status).toBe(
    404,
  )
  expect((await viewer()).status).toBe(404)
  expect((await readAssemblies(new Request('https://album.test/api/assemblies'))).status).toBe(404)
  expect((await upload(request({ guestName: 'Alex' }))).status).toBe(404)
  expect(runAction).not.toHaveBeenCalled()
})
