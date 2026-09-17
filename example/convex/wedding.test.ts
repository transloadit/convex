/// <reference types="vite/client" />

import { anyApi, componentsGeneric } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import componentSchema from '../../src/component/schema'
import schema from './schema'

// Example deployment bindings are generated during deployment, not required for offline tests.
vi.mock('./_generated/api', async () => {
  const { anyApi, componentsGeneric } = await import('convex/server')
  return { api: anyApi, internal: anyApi, components: componentsGeneric() }
})
vi.mock('./_generated/server', async () => {
  const { actionGeneric, internalMutationGeneric, queryGeneric } = await import('convex/server')
  return { action: actionGeneric, internalMutation: internalMutationGeneric, query: queryGeneric }
})
const api = anyApi
const components = componentsGeneric()

const setup = () => {
  const t = convexTest(schema, {
    './wedding.ts': () => import('./wedding'),
    './_generated/server.ts': () => import('convex/server'),
  })
  t.registerComponent(
    'transloadit',
    componentSchema,
    import.meta.glob('../../src/component/**/*.*s'),
  )
  return t
}

afterEach(() => vi.unstubAllEnvs())

test.each(['', ' \n\t ', 'x'.repeat(101)])(
  'rejects invalid guest names before signing or consuming the upload limit (%j)',
  async (guestName) => {
    const t = setup().withIdentity({ subject: 'guest-1' })
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
  const t = setup().withIdentity({ subject: 'guest-1' })
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
  const t = setup()
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
})
