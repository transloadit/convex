/// <reference types="vite/client" />

import { generateKeyPairSync } from 'node:crypto'
import { anyApi, componentsGeneric } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import componentSchema from '../../src/component/schema'
import { inviteVersion } from '../lib/album-access'
import schema from './schema'

// Example deployment bindings are generated during deployment, not required for offline tests.
vi.mock('./_generated/api', async () => {
  const { anyApi, componentsGeneric } = await import('convex/server')
  return { api: anyApi, internal: anyApi, components: componentsGeneric() }
})
vi.mock('./_generated/server', async () => {
  const {
    actionGeneric,
    internalActionGeneric,
    internalMutationGeneric,
    internalQueryGeneric,
    queryGeneric,
  } = await import('convex/server')
  return {
    action: actionGeneric,
    internalAction: internalActionGeneric,
    internalMutation: internalMutationGeneric,
    internalQuery: internalQueryGeneric,
    query: queryGeneric,
  }
})
const api = anyApi
const components = componentsGeneric()
const componentModules = import.meta.glob('../../src/component/**/*.*s')

// convex-test resolves every call into the component from its module export, so reading those
// exports counts the app's component calls.
const countComponentCalls = () => {
  const calls: string[] = []
  const modules = Object.fromEntries(
    Object.entries(componentModules).map(([path, load]) => [
      path,
      async () =>
        new Proxy((await load()) as Record<string, unknown>, {
          get: (module, name) => {
            const value = Reflect.get(module, name)
            if (
              typeof name === 'string' &&
              typeof value === 'function' &&
              ('isQuery' in value || 'isMutation' in value || 'isAction' in value)
            ) {
              calls.push(name)
            }
            return value
          },
        }),
    ]),
  )
  return { calls, modules }
}

const setup = (modules = componentModules, transactionLimits = false) => {
  const t = convexTest({
    schema,
    modules: {
      './wedding.ts': () => import('./wedding'),
      './guests.ts': () => import('./guests'),
      './transloadit.ts': () => import('./transloadit'),
      './auth.ts': () => import('./auth'),
      './_generated/server.ts': () => import('convex/server'),
    },
    transactionLimits,
  })
  t.registerComponent('transloadit', componentSchema, modules)
  return t
}

const persist = (
  t: ReturnType<typeof setup>,
  assemblyId: string,
  fields: Record<string, unknown>,
  results: Record<string, Record<string, unknown>[]>,
) =>
  t.action(components.transloadit.lib.handleWebhook, {
    verifySignature: false,
    payload: {
      assembly_id: assemblyId,
      ok: 'ASSEMBLY_COMPLETED',
      fields: { album: 'wedding-gallery', ...fields },
      results,
    },
  })

const photos = (assemblyId: string, count = 1) => ({
  images_output: Array.from({ length: count }, (_, index) => ({
    id: `${assemblyId}-${index}`,
    ssl_url: `https://example.com/${assemblyId}-${index}.jpg`,
  })),
})

const admitted = async (t = setup()) => {
  const subject = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Alex' })
    const sessionId = await ctx.db.insert('authSessions', {
      userId,
      expirationTime: Date.now() + 60000,
    })
    await ctx.db.insert('albumGuests', { userId, name: 'Alex', version: await inviteVersion() })
    return `${userId}|${sessionId}`
  })
  return t.withIdentity({ subject })
}

beforeEach(() => vi.stubEnv('WEDDING_UPLOAD_CODE', ''))

afterEach(() => vi.unstubAllEnvs())

test.each(['', ' \n\t ', 'x'.repeat(101)])(
  'rejects invalid guest names before signing or consuming the upload limit (%j)',
  async (guestName) => {
    const t = await admitted()
    await expect(
      t.action(api.wedding.createWeddingAssemblyOptions, { guestName, fileCount: 1 }),
    ).rejects.toThrow('NAME_REQUIRED')
    expect(await t.run((ctx) => ctx.db.query('uploadLimits').collect())).toHaveLength(0)
  },
)

test('signs the trimmed contributor name into the upload fields', async () => {
  vi.stubEnv('TRANSLOADIT_KEY', 'test-key')
  vi.stubEnv('TRANSLOADIT_SECRET', 'test-secret')
  vi.stubEnv('TRANSLOADIT_NOTIFY_URL', 'https://example.com/notify')
  vi.stubEnv('WEDDING_UPLOAD_CODE', '')
  vi.stubEnv('TRANSLOADIT_R2_CREDENTIALS', 'test-r2')
  const t = await admitted()
  const result = await t.action(api.wedding.createWeddingAssemblyOptions, {
    guestName: '  Олена  ',
    fileCount: 2,
  })
  const params =
    typeof result.assemblyOptions.params === 'string'
      ? JSON.parse(result.assemblyOptions.params)
      : result.assemblyOptions.params
  expect(params.fields).toMatchObject({
    guestName: 'Олена',
    fileCount: 2,
    album: 'wedding-gallery',
  })
})

test('reads contributors from persisted assemblies and scopes the gallery to this album', async () => {
  const t = await admitted()
  for (const [assemblyId, guestName, album] of [
    ['first', 'Олена', 'wedding-gallery'],
    ['second', 'Alex', 'wedding-gallery'],
    ['legacy', undefined, 'wedding-gallery'],
    ['private', 'Other album', 'another-album'],
  ] as const) {
    await t.action(components.transloadit.lib.handleWebhook, {
      verifySignature: false,
      payload: {
        assembly_id: assemblyId,
        ok: 'ASSEMBLY_COMPLETED',
        fields: { album, ...(guestName ? { guestName } : {}), privateMetadata: 'not-for-gallery' },
        results: {
          images_output: [
            {
              id: `${assemblyId}-result`,
              name: 'IMG_0001.jpg',
              ssl_url: `https://example.com/${assemblyId}.jpg`,
            },
          ],
        },
      },
    })
  }
  const results = await t.query(api.wedding.listGallery, {})
  expect(results).toHaveLength(3)
  expect(
    Object.fromEntries(results.map((result) => [result.assemblyId, result.uploadedBy])),
  ).toEqual({ first: 'Олена', second: 'Alex', legacy: undefined })
  expect(JSON.stringify(results)).not.toContain('not-for-gallery')
  const activity = await t.query(api.transloadit.listAssemblies, {})
  expect(activity).toHaveLength(3)
  expect(JSON.stringify(activity)).not.toContain('not-for-gallery')
  expect(activity.every((item) => item.raw === undefined && item.results === undefined)).toBe(true)
})

test('joins contributor names inside one component call, however many Assemblies', async () => {
  const { calls, modules } = countComponentCalls()
  const t = setup(modules)
  for (const [assemblyId, guestName] of [
    ['first', 'Олена'],
    ['second', 'Alex'],
    ['third', 'Sam'],
  ]) {
    await persist(t, assemblyId, { guestName }, photos(assemblyId))
  }
  const guest = await admitted(t)
  calls.length = 0
  const results = await guest.query(api.wedding.listGallery, {})
  expect(results.map((result: { uploadedBy?: string }) => result.uploadedBy).sort()).toEqual([
    'Alex',
    'Sam',
    'Олена',
  ])
  expect(calls).toEqual(['listAlbumResults'])
})

test('joins contributor names only for gallery results, so large Storage Assemblies hide none', async () => {
  // Convex's 16 MiB read limit is per query: the component's Assembly join shares listGallery's.
  const t = setup(componentModules, true)
  await persist(
    t,
    'video',
    { guestName: 'Sam' },
    {
      videos_output: [{ id: 'video-0', ssl_url: 'https://example.com/video-0.mp4' }],
    },
  )
  const upload = {
    name: 'IMG_0001.jpg',
    basename: 'IMG_0001',
    ext: 'jpg',
    size: 1,
    mime: 'image/jpeg',
    type: 'image',
    field: 'files[]',
    original_id: 'upload',
    url: 'https://example.com/upload.jpg',
  }
  for (let index = 0; index < 20; index += 1) {
    // Newer Storage-only Assemblies near Convex's 1 MiB document limit, as with hundreds of
    // uploads (the webhook stores `uploads` twice: as is and inside `raw`).
    await t.action(components.transloadit.lib.handleWebhook, {
      verifySignature: false,
      payload: {
        assembly_id: `stored-${index}`,
        ok: 'ASSEMBLY_COMPLETED',
        fields: { album: 'wedding-gallery', guestName: 'Alex' },
        uploads: [{ ...upload, meta: { padding: 'x'.repeat(450_000) } }],
        results: {
          images_stored: [{ id: `stored-${index}`, ssl_url: `https://example.com/${index}.jpg` }],
        },
      },
    })
  }
  const results = await (await admitted(t)).query(api.wedding.listGallery, {})
  expect(
    results.map((result: { assemblyId: string; uploadedBy?: string }) => [
      result.assemblyId,
      result.uploadedBy,
    ]),
  ).toEqual([['video', 'Sam']])
})

test('returns only the fields the gallery renders', async () => {
  const t = setup()
  await persist(
    t,
    'projected',
    { guestName: 'Alex', userId: 'guest-user' },
    {
      images_output: [
        {
          id: 'projected-result',
          name: 'IMG_0001.jpg',
          ssl_url: 'https://example.com/projected.jpg',
          size: 123,
          mime: 'image/jpeg',
          original_id: 'source',
          original_basename: 'IMG_0001',
          meta: { width: 4000, height: 3000, latitude: 52.37, camera_model: 'private' },
        },
      ],
    },
  )
  const results = await (await admitted(t)).query(api.wedding.listGallery, {})
  expect(results).toEqual([
    {
      _id: expect.any(String),
      assemblyId: 'projected',
      stepName: 'images_output',
      resultId: 'projected-result',
      sslUrl: 'https://example.com/projected.jpg',
      name: 'IMG_0001.jpg',
      createdAt: expect.any(Number),
      uploadedBy: 'Alex',
      raw: { original_id: 'source', meta: { width: 4000, height: 3000 } },
    },
  ])
})

test('bounds the gallery and applies the retention cutoff on the server', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const t = setup()
    const expiredAt = Date.UTC(2026, 8, 1)
    vi.setSystemTime(expiredAt)
    await persist(t, 'expired', { guestName: 'Alex' }, photos('expired'))
    vi.setSystemTime(expiredAt + 24 * 60 * 60 * 1000)
    await persist(t, 'recent', { guestName: 'Alex' }, photos('recent', 2))
    const guest = await admitted(t)

    const recent = await guest.query(api.wedding.listGallery, { createdAfter: expiredAt })
    expect(recent.map((result: { assemblyId: string }) => result.assemblyId)).toEqual([
      'recent',
      'recent',
    ])
    expect(await guest.query(api.wedding.listGallery, {})).toHaveLength(3)
    expect(await guest.query(api.wedding.listGallery, { limit: 2 })).toHaveLength(2)

    await persist(t, 'bulk', { guestName: 'Alex' }, photos('bulk', 81))
    expect(await guest.query(api.wedding.listGallery, {})).toHaveLength(80)
    expect(await guest.query(api.wedding.listGallery, { limit: 1000 })).toHaveLength(80)
    for (const args of [
      { limit: Number.NaN },
      { createdAfter: Number.NaN },
      { createdAfter: Number.POSITIVE_INFINITY },
    ]) {
      await expect(guest.query(api.wedding.listGallery, args)).rejects.toThrow(
        'Invalid album result',
      )
    }
  } finally {
    vi.useRealTimers()
  }
})

test('rejects unauthenticated and legacy anonymous sessions on every album read and write', async () => {
  for (const t of [setup(), setup().withIdentity({ subject: 'legacy-anonymous' })]) {
    for (const [query, args] of [
      [api.wedding.listGallery, {}],
      [api.transloadit.listAssemblies, {}],
      [api.transloadit.getAssemblyStatus, { assemblyId: 'private' }],
      [api.transloadit.listResults, { assemblyId: 'private' }],
    ] as const)
      await expect(t.query(query, args)).rejects.toThrow('ACCESS_REQUIRED')
    await expect(
      t.action(api.wedding.createWeddingAssemblyOptions, { guestName: 'Alex', fileCount: 1 }),
    ).rejects.toThrow('ACCESS_REQUIRED')
    await expect(
      t.action(api.transloadit.refreshAssembly, { assemblyId: 'private' }),
    ).rejects.toThrow('ACCESS_REQUIRED')
    expect(await t.query(api.guests.viewer, {})).toBeNull()
  }
})

test('status and result queries only reveal the current guest’s uploads from this album', async () => {
  const t = await admitted()
  const { userId } = await t.query(api.guests.viewer, {})
  for (const [assemblyId, owner, album] of [
    ['mine', userId, 'wedding-gallery'],
    ['other-guest', 'another-user', 'wedding-gallery'],
    ['other-album', userId, 'another-album'],
  ]) {
    await t.action(components.transloadit.lib.handleWebhook, {
      verifySignature: false,
      payload: {
        assembly_id: assemblyId,
        ok: 'ASSEMBLY_COMPLETED',
        fields: { album, userId: owner },
        results: {
          images_output: [{ id: assemblyId, ssl_url: `https://example.com/${assemblyId}.jpg` }],
        },
      },
    })
  }
  expect(await t.query(api.transloadit.getAssemblyStatus, { assemblyId: 'mine' })).toBeTruthy()
  expect(await t.query(api.transloadit.listResults, { assemblyId: 'mine' })).toHaveLength(1)
  for (const assemblyId of ['other-guest', 'other-album', 'missing']) {
    expect(await t.query(api.transloadit.getAssemblyStatus, { assemblyId })).toBeNull()
    expect(await t.query(api.transloadit.listResults, { assemblyId })).toEqual([])
  }
  expect(await t.query(api.wedding.listGallery, {})).toHaveLength(2)
})

test('enabling or changing the invitation code revokes previously admitted access', async () => {
  const t = await admitted()
  expect(await t.query(api.guests.viewer, {})).toMatchObject({ name: 'Alex' })
  vi.stubEnv('WEDDING_UPLOAD_CODE', 'new-private-code')
  expect(await t.query(api.guests.settings, {})).toEqual({ requiresInviteCode: true })
  expect(await t.query(api.guests.viewer, {})).toBeNull()
  await expect(t.query(api.wedding.listGallery, {})).rejects.toThrow('ACCESS_REQUIRED')
})

test('guest login requires the configured code, preserves the name, and logout revokes the old JWT', async () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  vi.stubEnv('JWT_PRIVATE_KEY', privateKey)
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site')
  vi.stubEnv('WEDDING_UPLOAD_CODE', 'test-invitation')
  const t = setup()
  for (const params of [{ guestName: 'Alex' }, { guestName: 'Alex', uploadCode: 'wrong' }]) {
    await expect(t.action(api.auth.signIn, { provider: 'guest', params })).rejects.toThrow(
      'INVITE_REQUIRED',
    )
  }
  await expect(
    t.action(api.auth.signIn, {
      provider: 'guest',
      params: { guestName: ' ', uploadCode: 'test-invitation' },
    }),
  ).rejects.toThrow('NAME_REQUIRED')
  const result = await t.action(api.auth.signIn, {
    provider: 'guest',
    params: { guestName: '  Олена  ', uploadCode: 'test-invitation' },
  })
  const { sub } = JSON.parse(Buffer.from(result.tokens.token.split('.')[1], 'base64url').toString())
  const guest = t.withIdentity({ subject: sub })
  expect(await guest.query(api.guests.viewer, {})).toMatchObject({ name: 'Олена' })
  await guest.action(api.auth.signOut, {})
  expect(await guest.query(api.guests.viewer, {})).toBeNull()
  await expect(guest.query(api.wedding.listGallery, {})).rejects.toThrow('ACCESS_REQUIRED')
})
