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

const setup = () => {
  const t = convexTest(schema, {
    './wedding.ts': () => import('./wedding'),
    './guests.ts': () => import('./guests'),
    './transloadit.ts': () => import('./transloadit'),
    './auth.ts': () => import('./auth'),
    './_generated/server.ts': () => import('convex/server'),
  })
  t.registerComponent(
    'transloadit',
    componentSchema,
    import.meta.glob('../../src/component/**/*.*s'),
  )
  return t
}

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
