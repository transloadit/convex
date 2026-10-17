/// <reference types="vite/client" />

import { anyApi, componentsGeneric } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
const workspace = 'open-test-prod'
const damId = (seed: string) => `${seed.padEnd(21, 'x').slice(0, 21)}A`
const link = (asset: { asset_id: string; version_id: string }) => ({
  assetId: asset.asset_id,
  versionId: asset.version_id,
})

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
  stepName = ':original',
) => {
  const options = await guest.action(api.wedding.createWeddingAssemblyOptions, {
    guestName: 'Alex',
    fileCount: 1,
  })
  const params = JSON.parse(options.assemblyOptions.params)
  // The store path ends with the literal Transloadit interpolation for the uploaded file name.
  const prefix = String(params.steps.originals_stored.path).replace(/\$\{file\.url_name\}$/, '')
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
      results: { [stepName]: [asset] },
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
  vi.stubEnv('TRANSLOADIT_WORKSPACE', workspace)
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://happy-otter-123.convex.cloud')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('private Storage uploads', () => {
  test.each([0, -1, 1.5, 13])(
    'rejects invalid batch size %s before consuming quota',
    async (fileCount) => {
      const t = setup()
      const guest = await admit(t, 'Alex')
      await expect(
        guest.action(api.wedding.createWeddingAssemblyOptions, { guestName: 'Alex', fileCount }),
      ).rejects.toThrow('INVALID_FILE_COUNT')
      expect(await t.run((ctx) => ctx.db.query('uploadLimits').collect())).toHaveLength(0)
    },
  )
  test('pausing new uploads keeps existing private media readable without a public fallback', async () => {
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { asset } = await upload(guest, t, 'before-rollback')
    vi.stubEnv('TRANSLOADIT_STORAGE_UPLOADS_DISABLED', '1')
    await expect(
      guest.action(api.wedding.createWeddingAssemblyOptions, {
        guestName: 'Alex',
        fileCount: 1,
      }),
    ).rejects.toThrow('UPLOADS_UNAVAILABLE')
    expect(await guest.query(api.media.forDelivery, request(asset))).toMatchObject({
      asset_id: asset.asset_id,
      version_id: asset.version_id,
    })
  })

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
    // Direct originals preserve photo and video bytes, independently of the viewing derivatives.
    expect(params.steps.originals_stored).toMatchObject({
      robot: '/transloadit/store',
      use: ':original',
      conflict_strategy: 'rename',
    })
    // No permanent public or temporary processing result URLs are sent to the gallery.
    expect(params.steps.images_output).toBeUndefined()
    expect(params.steps.images_resized).toBeUndefined()
    expect(params.steps.videos_output).toBeUndefined()
    expect(params.steps.videos_stored).toMatchObject({
      robot: '/transloadit/store',
      use: 'video_encode',
    })
    expect(params.steps.posters_stored).toMatchObject({
      robot: '/transloadit/store',
      use: 'video_poster',
    })
    expect(params.steps.video_encode.result).toBe(true)
    expect(params.steps.video_poster.result).toBe(true)
    const uploads = await t.run((ctx) => ctx.db.query('uploads').collect())
    expect(uploads).toEqual([
      expect.objectContaining({ uploadId: params.fields.uploadId, storagePrefix: prefix }),
    ])
  })

  test('a configured Workspace without a unique namespace fails closed', async () => {
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
    expect(params.steps.originals_stored.path).toMatch(
      /^convex-demo\/kvz-laptop\/wedding-gallery\//,
    )
  })

  test('refuses new uploads without a Storage Workspace before consuming the upload quota', async () => {
    vi.stubEnv('TRANSLOADIT_WORKSPACE', '')
    const t = setup()
    const guest = await admit(t, 'Alex')
    await expect(
      guest.action(api.wedding.createWeddingAssemblyOptions, {
        guestName: 'Alex',
        fileCount: 1,
      }),
    ).rejects.toThrow('UPLOADS_UNAVAILABLE')
    expect(await t.run((ctx) => ctx.db.query('uploadLimits').collect())).toHaveLength(0)
  })

  test('a saved processing Template still gets literal, signed server-owned Storage paths', async () => {
    vi.stubEnv('TRANSLOADIT_WEDDING_TEMPLATE_ID', 'test-template')
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { params, prefix } = await upload(guest, t, 'template')
    expect(params.template_id).toBe('test-template')
    expect(Object.keys(params.steps).sort()).toEqual([
      'originals_stored',
      'posters_stored',
      'videos_stored',
    ])
    expect(params.steps.originals_stored.path).toBe(`${prefix}\${file.url_name}`)
    expect(JSON.stringify(params.steps)).not.toContain('${fields.')
  })
})

describe('gallery and delivery authorization', () => {
  test('excludes hidden history before paging without revoking retained exact versions', async () => {
    const startedAt = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt)
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { asset: old } = await upload(guest, t, 'old')
    now.mockReturnValue(startedAt + 100)
    await upload(guest, t, 'boundary')
    now.mockReturnValue(startedAt + 200)
    const { asset: recent } = await upload(guest, t, 'recent')
    now.mockReturnValue(startedAt + 300)
    const { asset: newest } = await upload(guest, t, 'newest')
    const createdAfter = startedAt + 100

    const first = await guest.query(api.media.list, {
      createdAfter,
      paginationOpts: { numItems: 1, cursor: null },
    })
    expect(first.page.map((row: { asset: { asset_id: string } }) => row.asset.asset_id)).toEqual([
      newest.asset_id,
    ])
    const rest = await guest.query(api.media.list, {
      createdAfter,
      paginationOpts: { numItems: 24, cursor: first.continueCursor },
    })
    expect(rest.page.map((row: { asset: { asset_id: string } }) => row.asset.asset_id)).toEqual([
      recent.asset_id,
    ])
    expect(rest.isDone).toBe(true)
    expect(await guest.query(api.media.get, link(old))).toMatchObject({
      asset: { asset_id: old.asset_id, version_id: old.version_id },
    })
    expect(await guest.query(api.media.forDelivery, request(old))).toMatchObject({
      asset_id: old.asset_id,
    })
  })

  test('a shared exact-version link resolves outside the loaded page, without listing all pages', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'older')
    const { asset: newer } = await upload(alex, t, 'newer')
    const first = await alex.query(api.media.list, {
      paginationOpts: { numItems: 1, cursor: null },
    })
    expect(first.page).toHaveLength(1)
    expect(first.page[0].asset.asset_id).toBe(newer.asset_id)
    expect(await alex.query(api.media.get, link(asset))).toMatchObject({
      asset: { asset_id: asset.asset_id, version_id: asset.version_id },
      uploadedBy: 'Alex',
    })
    expect(
      await alex.query(api.media.get, { ...link(asset), versionId: damId('absent') }),
    ).toBeNull()
  })

  test('keeps existing private photos reported under their producing step', async () => {
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { asset } = await upload(guest, t, 'legacy', undefined, {}, 'images_filtered')
    const page = await guest.query(api.media.list, {
      paginationOpts: { numItems: 24, cursor: null },
    })
    expect(page.page).toEqual([
      expect.objectContaining({ asset: expect.objectContaining({ asset_id: asset.asset_id }) }),
    ])
  })

  test('joins private video renditions by source identity even in an Assembly with over 500 results', async () => {
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { assemblyOptions } = await guest.action(api.wedding.createWeddingAssemblyOptions, {
      guestName: 'Alex',
      fileCount: 2,
    })
    const params = JSON.parse(assemblyOptions.params)
    const prefix = String(params.steps.originals_stored.path).replace(/\$\{file\.url_name\}$/, '')
    const result = (seed: string, mime: string, originalId: string) => ({
      id: `result-${seed}`,
      original_id: originalId,
      workspace,
      asset_id: damId(`asset${seed}`),
      version_id: damId(`version${seed}`),
      path: `${prefix}${seed}.dat`,
      size: 1234,
      mime,
      width: 1280,
      height: 720,
    })
    const original = result('original', 'video/quicktime', 'source-1')
    const video = result('encoded', 'video/mp4', 'source-1')
    const poster = result('poster', 'image/jpeg', 'source-1')
    const other = result('other', 'video/mp4', 'source-2')
    await t.action(components.transloadit.lib.handleWebhook, {
      verifySignature: false,
      storage: { workspace },
      payload: {
        assembly_id: 'assembly-video',
        ok: 'ASSEMBLY_COMPLETED',
        fields: params.fields,
        results: {
          ':original': [original],
          video_encode: [
            video,
            other,
            ...Array.from({ length: 500 }, (_, i) =>
              result(`unrelated-${i}`, 'video/mp4', `unrelated-${i}`),
            ),
          ],
          video_poster: [poster],
        },
      },
    })
    const first = await guest.query(api.media.list, {
      paginationOpts: { numItems: 1, cursor: null },
    })
    // A page of one media item must not first spend a page on its poster or encode.
    expect(first.page).toHaveLength(1)
    expect(first.page[0]?.asset.asset_id).toBe(original.asset_id)
    const rest = await guest.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: first.continueCursor },
    })
    expect([...first.page, ...rest.page]).toEqual([
      expect.objectContaining({
        asset: expect.objectContaining({ asset_id: original.asset_id }),
        video: expect.objectContaining({ asset_id: video.asset_id }),
        poster: expect.objectContaining({ asset_id: poster.asset_id }),
      }),
    ])
    expect(await guest.query(api.media.get, link(original))).toEqual(first.page[0])
    expect(await guest.query(api.media.get, link(video))).toBeNull()
    // Video dimensions do not turn a video into an authorized image-preview input.
    expect(await guest.query(api.media.forDelivery, request(video))).toBeNull()
    expect(await guest.query(api.media.forDelivery, request(poster))).toMatchObject({
      mime: 'image/jpeg',
    })
    expect(await guest.query(api.media.forDelivery, request(original, 'download'))).toMatchObject({
      mime: 'video/quicktime',
    })
    expect(await t.query(api.media.forDelivery, request(video, 'original'))).toBeNull()
    expect(await t.query(api.media.forDelivery, request(poster, 'original'))).toBeNull()
    await t.mutation(components.transloadit.lib.requestStoredAssetDeletion, {
      album: 'wedding-gallery',
      createdBefore: Date.now() + 1,
      limit: 500,
    })
    // The large Assembly spans two bounded deletion batches; no receipt is revoked until selected.
    await t.mutation(components.transloadit.lib.requestStoredAssetDeletion, {
      album: 'wedding-gallery',
      createdBefore: Date.now() + 1,
      limit: 500,
    })
    expect(await guest.query(api.media.forDelivery, request(video, 'original'))).toBeNull()
    expect(await guest.query(api.media.forDelivery, request(poster, 'original'))).toBeNull()
  })

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

  test('grouped renditions still need their own upload-path and preview authorization', async () => {
    const t = setup()
    const guest = await admit(t, 'Alex')
    const { params, prefix, asset } = await upload(guest, t, 'original', (path) => ({
      path: `${path}original.mov`,
      mime: 'video/quicktime',
      original_id: 'video-source',
    }))
    const playback = {
      ...asset,
      id: 'playback',
      asset_id: damId('outside-video'),
      version_id: damId('outside-version'),
      // Matching Assembly fields and source IDs do not authorize an outside-prefix path.
      path: 'another-upload/video.mp4',
      mime: 'video/mp4',
    }
    const poster = {
      ...asset,
      id: 'poster',
      asset_id: damId('poster'),
      version_id: damId('poster-version'),
      path: `${prefix}poster.jpg`,
      mime: 'image/jpeg',
      width: undefined,
      thumbhash: 'AAAAAAAA',
    }
    await t.action(components.transloadit.lib.handleWebhook, {
      verifySignature: false,
      storage: { workspace },
      payload: {
        assembly_id: 'assembly-original',
        ok: 'ASSEMBLY_COMPLETED',
        fields: params.fields,
        results: { ':original': [asset], video_encode: [playback], video_poster: [poster] },
      },
    })
    const page = await guest.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toHaveLength(1)
    expect(page.page[0]).not.toHaveProperty('video')
    expect(page.page[0]).not.toHaveProperty('poster')
    expect(await guest.query(api.media.get, link(asset))).toEqual(page.page[0])
    expect(JSON.stringify(page)).not.toContain('AAAAAAAA')
    expect(await guest.query(api.media.forDelivery, request(playback, 'original'))).toBeNull()
    expect(await guest.query(api.media.forDelivery, request(poster, 'preview'))).toBeNull()
    expect(
      await guest.query(api.media.forDelivery, request(poster, 'download')),
    ).not.toHaveProperty('thumbhash')
    vi.stubEnv('WEDDING_UPLOAD_CODE', 'rotated-invitation')
    await expect(
      guest.query(api.media.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow('ACCESS_REQUIRED')
  })

  test('denies anonymous, expired and revoked sessions with null', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    const expired = await admit(t, 'Late', -1)
    expect(await t.query(api.media.forDelivery, request(asset))).toBeNull()
    expect(await expired.query(api.media.forDelivery, request(asset))).toBeNull()
    expect(await t.query(api.media.get, link(asset))).toBeNull()
    expect(await expired.query(api.media.get, link(asset))).toBeNull()
    await expect(
      t.query(api.media.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow('ACCESS_REQUIRED')
    await expect(
      expired.query(api.media.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow('ACCESS_REQUIRED')
    vi.stubEnv('WEDDING_UPLOAD_CODE', 'rotated-invitation')
    expect(await alex.query(api.media.forDelivery, request(asset, 'download'))).toBeNull()
    expect(await alex.query(api.media.get, link(asset))).toBeNull()
  })

  test('denies wrong versions, unknown assets and unsupported actions', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    const { asset } = await upload(alex, t, 'a')
    for (const denied of [
      { ...asset, version_id: damId('otherversion') },
      { ...asset, asset_id: damId('otherasset') },
    ]) {
      expect(await alex.query(api.media.forDelivery, request(denied))).toBeNull()
      expect(await alex.query(api.media.get, link(denied))).toBeNull()
    }
    await expect(alex.query(api.media.forDelivery, request(asset, 'thumbnail'))).rejects.toThrow()
  })

  test('rejects non-finite display cutoffs with a fixed component error', async () => {
    const t = setup()
    const guest = await admit(t, 'Alex')
    await expect(
      guest.query(api.media.list, {
        createdAfter: Number.POSITIVE_INFINITY,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow('Invalid Storage media cutoff')
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
    for (const { asset } of cases) {
      expect(await alex.query(api.media.forDelivery, request(asset, 'original'))).toBeNull()
      expect(await alex.query(api.media.get, link(asset))).toBeNull()
    }
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

  test('other files stored from :original are neither listed nor delivered', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    // Uppy's type restriction is client-side only; the Assembly stores every uploaded original.
    const { asset } = await upload(alex, t, 'page', (prefix) => ({
      path: `${prefix}page.html`,
      mime: 'text/html',
      width: undefined,
      height: undefined,
    }))
    const page = await alex.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toEqual([])
    for (const action of ['preview', 'original', 'download'])
      expect(await alex.query(api.media.forDelivery, request(asset, action))).toBeNull()
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
    expect(await alex.query(api.media.get, link(asset))).toBeNull()
    const page = await alex.query(api.media.list, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toEqual([])
  })

  test('the gallery forwards page splits and refused cursors to the client', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    await upload(alex, t, 'a')
    const list = (paginationOpts: Record<string, unknown>) =>
      alex.query(api.media.list, {
        paginationOpts: { numItems: 1, cursor: null, ...paginationOpts },
      })
    const first = await list({})
    await upload(alex, t, 'b')
    await upload(alex, t, 'c')
    // A loaded page that outgrew its read bound asks to be split and keeps its end.
    expect(await list({ endCursor: first.continueCursor, maximumRowsRead: 2 })).toMatchObject({
      pageStatus: 'SplitRequired',
      splitCursor: expect.any(String),
      continueCursor: first.continueCursor,
    })
    // usePaginatedQuery restarts on InvalidCursor, for example after an earlier release's cursor.
    await expect(list({ cursor: JSON.stringify([Date.now(), Date.now()]) })).rejects.toThrow(
      'InvalidCursor',
    )
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
        results: { ':original': [{ ...asset, id: 'v2', version_id: damId('fresh') }] },
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
  test('the retired gallery query returns no public exports', async () => {
    const t = setup()
    const alex = await admit(t, 'Alex')
    await upload(alex, t, 'a', (prefix) => ({ path: `${prefix}a.jpg`, thumbhash: 'AAAAAAAA' }))
    const legacy = await alex.query(api.wedding.listGallery, {})
    expect(legacy.map((result: { stepName: string }) => result.stepName)).not.toContain(':original')
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
