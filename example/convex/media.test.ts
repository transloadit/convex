/// <reference types="vite/client" />

import { anyApi, componentsGeneric } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import componentSchema from '../../src/component/schema'
import { inviteVersion } from '../lib/album-access'
import { r2OutputSteps } from '../lib/transloadit-steps'
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
const workspace = 'open-test-prod'
const damId = (seed: string) => `${seed.padEnd(21, 'x').slice(0, 21)}A`

const setup = () => {
  const t = convexTest(schema, {
    './media.ts': () => import('./media'),
    './storageCleanup.ts': () => import('./storageCleanup'),
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

const admit = async (t: ReturnType<typeof setup>, name: string, expiresIn = 60_000) => {
  const subject = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name })
    const sessionId = await ctx.db.insert('authSessions', {
      userId,
      expirationTime: Date.now() + expiresIn,
    })
    await ctx.db.insert('albumGuests', { userId, name, version: await inviteVersion() })
    return `${userId}|${sessionId}`
  })
  return t.withIdentity({ subject })
}

// Signs Assembly options as the guest, then completes that Assembly with Storage receipts.
const upload = async (
  guest: Awaited<ReturnType<typeof admit>>,
  t: ReturnType<typeof setup>,
  seed: string,
  receipt: (prefix: string) => Record<string, unknown> = (prefix) => ({
    path: `${prefix}${seed}.jpg`,
  }),
  fieldOverrides: Record<string, unknown> = {},
) => {
  const options = await guest.action(api.wedding.createWeddingAssemblyOptions, {
    guestName: 'Alex',
    fileCount: 1,
  })
  const params = JSON.parse(options.assemblyOptions.params)
  // The store path ends with the literal Transloadit interpolation for the uploaded file name.
  const prefix = String(params.steps.images_stored.path).replace(/\$\{file\.url_name\}$/, '')
  const asset = {
    id: `result-${seed}`,
    workspace,
    asset_id: damId(`asset${seed}`),
    version_id: damId(`version${seed}`),
    size: 1234,
    mime: 'image/jpeg',
    width: 1600,
    height: 1067,
    ...receipt(prefix),
  }
  await t.action(components.transloadit.lib.handleWebhook, {
    verifySignature: false,
    storage: { workspace },
    payload: {
      assembly_id: `assembly-${seed}`,
      ok: 'ASSEMBLY_COMPLETED',
      fields: { ...params.fields, ...fieldOverrides },
      results: { images_stored: [asset] },
    },
  })
  return { params, prefix, asset }
}

const request = (asset: { asset_id: string; version_id: string }, action = 'preview') => ({
  asset_id: asset.asset_id,
  version_id: asset.version_id,
  action,
})

beforeEach(() => {
  vi.stubEnv('WEDDING_UPLOAD_CODE', '')
  vi.stubEnv('TRANSLOADIT_KEY', 'test-key')
  vi.stubEnv('TRANSLOADIT_SECRET', 'test-secret')
  vi.stubEnv('TRANSLOADIT_NOTIFY_URL', 'https://example.com/notify')
  vi.stubEnv('TRANSLOADIT_R2_CREDENTIALS', 'test-r2')
  vi.stubEnv('TRANSLOADIT_WORKSPACE', workspace)
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://happy-otter-123.convex.cloud')
})

afterEach(() => vi.unstubAllEnvs())

describe('private Storage uploads', () => {
  test('signs a server-chosen Storage prefix and records the upload before signing', async () => {
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { params, prefix } = await upload(guest, t, 'a')
    expect(prefix).toMatch(/^convex-demo\/happy-otter-123\/wedding-gallery\/[0-9a-f-]{36}\/$/)
    expect(params.fields.uploadId).toBe(prefix.split('/')[3])
    expect(params.steps[':original']).toEqual({
      robot: '/upload/handle',
      output_meta: { thumbhash: true },
    })
    // Stores a photo filter of `:original`; see the watermark scope note on the Step.
    expect(params.steps.images_stored).toMatchObject({
      robot: '/transloadit/store',
      use: 'images_filtered',
      conflict_strategy: 'rename',
    })
    expect(params.steps.images_filtered).toMatchObject({ robot: '/file/filter', use: ':original' })
    // Private photos must not also get public R2 renditions; video keeps its R2 path.
    expect(params.steps.images_output).toBeUndefined()
    expect(params.steps.images_resized).toBeUndefined()
    expect(params.steps.videos_output).toMatchObject({ robot: '/cloudflare/store' })
    const uploads = await t.run((ctx) => ctx.db.query('uploads').collect())
    expect(uploads).toEqual([
      expect.objectContaining({ uploadId: params.fields.uploadId, storagePrefix: prefix }),
    ])
  })

  test('a configured Workspace without a unique namespace fails closed instead of using R2', async () => {
    vi.stubEnv('CONVEX_CLOUD_URL', 'http://127.0.0.1:3210')
    const t = setup()
    const guest = await admit(t, 'Alex')
    const sign = () =>
      guest.action(api.wedding.createWeddingAssemblyOptions, { guestName: 'Alex', fileCount: 1 })
    await expect(sign()).rejects.toThrow('TRANSLOADIT_STORAGE_NAMESPACE')
    vi.stubEnv('TRANSLOADIT_STORAGE_NAMESPACE', 'Not A Namespace!')
    await expect(sign()).rejects.toThrow('TRANSLOADIT_STORAGE_NAMESPACE')
    expect(await t.query(api.storageCleanup.summary, { album: 'wedding-gallery' })).toMatchObject({
      storagePrefix: null,
    })
    vi.stubEnv('TRANSLOADIT_STORAGE_NAMESPACE', 'kvz-laptop')
    const params = JSON.parse((await sign()).assemblyOptions.params)
    expect(params.steps.images_stored.path).toMatch(/^convex-demo\/kvz-laptop\/wedding-gallery\//)
  })

  test('keeps the R2-only pipeline when no Storage Workspace is configured', async () => {
    vi.stubEnv('TRANSLOADIT_WORKSPACE', '')
    const t = setup()
    const guest = await admit(t, 'Alex')
    const options = await guest.action(api.wedding.createWeddingAssemblyOptions, {
      guestName: 'Alex',
      fileCount: 1,
    })
    const params = JSON.parse(options.assemblyOptions.params)
    expect(params.steps.images_stored).toBeUndefined()
    expect(params.steps.images_output).toMatchObject({ robot: '/cloudflare/store' })
    expect(params.steps[':original']).toEqual({ robot: '/upload/handle' })
    // Cleanup relies on this list to know which results are the only references to R2 media.
    const r2Steps = Object.entries(params.steps as Record<string, { robot: string }>)
      .filter(([, step]) => step.robot === '/cloudflare/store')
      .map(([name]) => name)
    expect(r2Steps.sort()).toEqual([...r2OutputSteps].sort())
  })
})

describe('gallery and delivery authorization', () => {
  test('admitted guests list and receive exact receipts for every action', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    const sam = await admit(t, 'Sam')
    const page = await sam.query(api.media.list, { paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page).toEqual([
      expect.objectContaining({
        uploadedBy: 'Alex',
        asset: expect.objectContaining({ asset_id: asset.asset_id, version_id: asset.version_id }),
      }),
    ])
    expect(JSON.stringify(page)).not.toContain('https://')
    for (const action of ['preview', 'original', 'download']) {
      const receipt = await sam.query(api.media.forDelivery, request(asset, action))
      expect(receipt).toMatchObject({ workspace, asset_id: asset.asset_id, width: 1600 })
    }
  })

  test('denies anonymous, expired and revoked sessions with null', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    const expired = await admit(t, 'Late', -1)
    expect(await t.query(api.media.forDelivery, request(asset))).toBeNull()
    expect(await expired.query(api.media.forDelivery, request(asset))).toBeNull()
    await expect(
      t.query(api.media.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow('ACCESS_REQUIRED')
    vi.stubEnv('WEDDING_UPLOAD_CODE', 'rotated-invitation')
    expect(await alex.query(api.media.forDelivery, request(asset, 'download'))).toBeNull()
  })

  test('denies wrong versions, unknown assets and unsupported actions', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    for (const denied of [
      { ...asset, version_id: damId('otherversion') },
      { ...asset, asset_id: damId('otherasset') },
    ])
      expect(await alex.query(api.media.forDelivery, request(denied))).toBeNull()
    await expect(alex.query(api.media.forDelivery, request(asset, 'thumbnail'))).rejects.toThrow()
  })

  test('ignores receipts that are not bound to a matching server-created upload', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const cases = [
      await upload(alex, t, 'outside', () => ({
        path: 'convex-demo/happy-otter-123/elsewhere/x.jpg',
      })),
      await upload(alex, t, 'nested', (prefix) => ({ path: `${prefix}nested/x.jpg` })),
      await upload(alex, t, 'album', undefined, { album: 'another-album' }),
      await upload(alex, t, 'owner', undefined, { userId: 'someone-else' }),
      await upload(alex, t, 'forged', undefined, { uploadId: 'not-a-server-upload' }),
    ]
    const page = await alex.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toEqual([])
    for (const { asset } of cases)
      expect(await alex.query(api.media.forDelivery, request(asset, 'original'))).toBeNull()
  })

  test('previews need image geometry, while originals of other media remain deliverable', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'clip', (prefix) => ({
      path: `${prefix}clip.mp4`,
      mime: 'video/mp4',
      width: undefined,
      height: undefined,
    }))
    expect(await alex.query(api.media.forDelivery, request(asset, 'preview'))).toBeNull()
    expect(await alex.query(api.media.forDelivery, request(asset, 'download'))).toMatchObject({
      mime: 'video/mp4',
    })
  })

  test('ThumbHash pixels reach only guests who may preview that exact version', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const thumbhash = 'IvkFHYx/iHiHh3h3d3h4d494+IiI'
    await upload(alex, t, 'photo', (prefix) => ({ path: `${prefix}photo.jpg`, thumbhash }))
    // Geometry-less receipts are original-only: forDelivery refuses previews for them.
    const { asset: originalOnly } = await upload(alex, t, 'raw', (prefix) => ({
      path: `${prefix}raw.jpg`,
      width: undefined,
      height: undefined,
      thumbhash,
    }))
    expect(await alex.query(api.media.forDelivery, request(originalOnly))).toBeNull()
    const original = await alex.query(api.media.forDelivery, request(originalOnly, 'original'))
    expect(original).toMatchObject({ asset_id: originalOnly.asset_id })
    expect(original).not.toHaveProperty('thumbhash')
    const page = await alex.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    const hashes = Object.fromEntries(
      page.page.map(({ asset }: { asset: { path: string; thumbhash?: string } }) => [
        asset.path.slice(asset.path.lastIndexOf('/') + 1),
        asset.thumbhash,
      ]),
    )
    expect(hashes).toEqual({ 'photo.jpg': thumbhash, 'raw.jpg': undefined })
  })

  test('hidden assets disappear from the gallery and delivery before Storage deletion', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    await t.mutation(components.transloadit.lib.requestStoredAssetDeletion, {
      album: 'wedding-gallery',
      createdBefore: Date.now() + 1,
    })
    expect(await alex.query(api.media.forDelivery, request(asset, 'original'))).toBeNull()
    const page = await alex.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toEqual([])
  })
})

describe('cleanup previews follow the expiry rules', () => {
  test('an asset with a fresh version is not previewed as expired', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    const cutoff = Date.now() + 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    await t.action(components.transloadit.lib.handleWebhook, {
      verifySignature: false,
      storage: { workspace },
      payload: {
        assembly_id: 'assembly-overwrite',
        ok: 'ASSEMBLY_COMPLETED',
        fields: {},
        results: { images_stored: [{ ...asset, id: 'v2', version_id: damId('fresh') }] },
      },
    })
    const preview = await t.query(api.storageCleanup.previewExpiry, {
      album: 'wedding-gallery',
      createdBefore: cutoff,
      limit: 100,
    })
    expect(preview.requested).toEqual([])
  })
})

describe('council regressions', () => {
  test('the R2 gallery query never returns Storage receipts or their ThumbHash', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    await upload(alex, t, 'a', (prefix) => ({ path: `${prefix}a.jpg`, thumbhash: 'AAAAAAAA' }))
    const legacy = await alex.query(api.wedding.listGallery, {})
    expect(legacy.map((result: { stepName: string }) => result.stepName)).not.toContain(
      'images_stored',
    )
    expect(JSON.stringify(legacy)).not.toContain('AAAAAAAA')
  })

  test('private photos keep their Assembly provenance for the gallery', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    await upload(alex, t, 'a')
    const page = await alex.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page[0]).toMatchObject({ assemblyId: 'assembly-a' })
  })
})

describe('cleanup summary', () => {
  test('reports the backend prefix and pages visible receipts per album', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    await upload(alex, t, 'a')
    expect(await t.query(api.storageCleanup.summary, { album: 'wedding-gallery' })).toMatchObject({
      resultsTruncated: false,
      storagePrefix: 'convex-demo/happy-otter-123/wedding-gallery/',
    })
    expect(
      await t.query(api.storageCleanup.visiblePage, { album: 'wedding-gallery', cursor: null }),
    ).toMatchObject({ count: 1, isDone: true })
    expect(
      await t.query(api.storageCleanup.visiblePage, { album: 'another-album', cursor: null }),
    ).toMatchObject({ count: 0, isDone: true })
  })
})
