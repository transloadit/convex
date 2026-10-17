/// <reference types="vite/client" />

import type { PaginationOptions } from 'convex/server'
import type { ObjectType } from 'convex/values'
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import type { vStoredAssetFields } from '../shared/schemas.ts'
import { api } from './_generated/api.ts'
import schema from './schema.ts'
import { modules } from './setup.test.ts'

const setup = () => convexTest(schema, modules)
type Test = ReturnType<typeof setup>
type Fields = ObjectType<typeof vStoredAssetFields>

const asset = (seed: string) => ({
  workspace: 'test-workspace',
  asset_id: `asset-${seed}`,
  version_id: `version-${seed}`,
  path: `uploads/upload-1/${seed}.jpg`,
  size: 1234,
  mime: 'image/jpeg',
  width: 1200,
  height: 800,
})

const insert = (t: Test, seed: string, fields: Partial<Fields> = {}) =>
  t.run((ctx) =>
    ctx.db.insert('storedAssets', {
      asset: asset(seed),
      assemblyId: 'assembly-1',
      album: 'album-1',
      userId: 'user-1',
      uploadId: 'upload-1',
      stepName: ':original',
      originalId: `source-${seed}`,
      resultId: `result-${seed}`,
      createdAt: Date.now(),
      ...fields,
    }),
  )

const list = (
  t: Test,
  paginationOpts: PaginationOptions = { numItems: 10, cursor: null },
  createdAfter?: number,
) =>
  t.query(api.lib.listStoredMedia, {
    album: 'album-1',
    originalSteps: [':original', 'legacy-original'],
    renditions: { playback: 'encode', poster: 'poster' },
    createdAfter,
    paginationOpts,
  })

const get = (t: Test, seed: string) =>
  t.query(api.lib.getStoredMedia, {
    album: 'album-1',
    originalSteps: [':original', 'legacy-original'],
    renditions: { playback: 'encode', poster: 'poster' },
    workspace: 'test-workspace',
    assetId: `asset-${seed}`,
    versionId: `version-${seed}`,
  })

describe('stored media', () => {
  test('pages originals, not their renditions, and joins beyond the old sibling-scan limit', async () => {
    const t = setup()
    const original = await insert(t, 'original')
    for (let index = 0; index < 501; index += 1) {
      await insert(t, `unrelated-${index}`, { stepName: 'encode' })
    }
    const playback = await insert(t, 'playback', {
      stepName: 'encode',
      originalId: 'source-original',
    })
    const poster = await insert(t, 'poster', {
      stepName: 'poster',
      originalId: ['source-original'],
    })
    const first = await list(t, { numItems: 1, cursor: null })
    expect(first.page).toEqual([
      expect.objectContaining({
        original: expect.objectContaining({ _id: original }),
        renditions: {
          playback: expect.objectContaining({ _id: playback }),
          poster: expect.objectContaining({ _id: poster }),
        },
      }),
    ])
    expect(await get(t, 'original')).toEqual(first.page[0])
    const rest = await list(t, { numItems: 10, cursor: first.continueCursor })
    expect(rest.page).toEqual([])
    expect(rest.isDone).toBe(true)
  })

  test('merges legacy and direct originals newest first without duplicate Steps or rendition pages', async () => {
    const t = setup()
    const oldest = await insert(t, 'oldest', { stepName: 'legacy-original', createdAt: 1 })
    const middle = await insert(t, 'middle', { createdAt: 2 })
    const newest = await insert(t, 'newest', { stepName: 'legacy-original', createdAt: 3 })
    await insert(t, 'orphan-poster', { stepName: 'poster', createdAt: 4 })
    const first = await t.query(api.lib.listStoredMedia, {
      album: 'album-1',
      originalSteps: [':original', 'legacy-original', ':original'],
      renditions: {},
      paginationOpts: { numItems: 2, cursor: null },
    })
    const last = await list(t, { numItems: 2, cursor: first.continueCursor })
    expect(first.page.map((item) => item.original._id)).toEqual([newest, middle])
    expect(last.page.map((item) => item.original._id)).toEqual([oldest])
    expect(last.isDone).toBe(true)
  })

  test.each([
    { assemblyId: 'another-assembly' },
    { album: 'another-album' },
    { userId: 'another-user' },
    { userId: undefined },
    { uploadId: 'another-upload' },
    { uploadId: undefined },
    { originalId: 'another-source' },
    { originalId: ['source-original', 'another-source'] },
    { originalId: ['source-original', null] },
    { originalId: undefined },
    { asset: { ...asset('other-workspace'), workspace: 'another-workspace' } },
  ])('never joins a rendition with incompatible provenance: %j', async (mismatch) => {
    const t = setup()
    await insert(t, 'original')
    await insert(t, 'wrong', {
      stepName: 'encode',
      originalId: 'source-original',
      // Even an identical filename is not source identity.
      asset: { ...asset('wrong'), path: asset('original').path },
      ...mismatch,
    })
    expect((await list(t)).page[0]?.renditions).toEqual({})
    expect((await get(t, 'original'))?.renditions).toEqual({})
  })

  test('keeps identical filenames from two originals separate, accepting either single-ID shape', async () => {
    const t = setup()
    await insert(t, 'first', { originalId: ['source-first'], createdAt: 1 })
    await insert(t, 'second', { createdAt: 2 })
    const playback = await insert(t, 'first-video', {
      stepName: 'encode',
      originalId: 'source-first',
      asset: { ...asset('first-video'), path: asset('second').path },
    })
    const page = (await list(t)).page
    expect(page[0]?.renditions).toEqual({})
    expect(page[1]?.renditions.playback?._id).toBe(playback)
  })

  test('returns partial media without guessing absent, ambiguous or multi-input roles', async () => {
    const t = setup()
    const original = await insert(t, 'original')
    const poster = await insert(t, 'poster', { stepName: 'poster', originalId: 'source-original' })
    await insert(t, 'video-a', { stepName: 'encode', originalId: 'source-original' })
    await insert(t, 'video-b', { stepName: 'encode', originalId: ['source-original'] })
    expect((await list(t)).page[0]?.renditions).toEqual({
      poster: expect.objectContaining({ _id: poster }),
    })
    expect((await get(t, 'original'))?.renditions).toEqual({
      poster: expect.objectContaining({ _id: poster }),
    })
    await t.run((ctx) => ctx.db.patch(original, { originalId: ['source-original', 'second'] }))
    expect((await list(t)).page[0]?.renditions).toEqual({})
    expect((await get(t, 'original'))?.renditions).toEqual({})
    await t.run((ctx) => ctx.db.patch(original, { originalId: undefined }))
    expect((await list(t)).page).toEqual([
      expect.objectContaining({
        original: expect.objectContaining({ _id: original }),
        renditions: {},
      }),
    ])
  })

  test('hides deletion-requested originals and renditions, including confirmed tombstones', async () => {
    const t = setup()
    await insert(t, 'visible')
    const poster = await insert(t, 'poster', { stepName: 'poster', originalId: 'source-visible' })
    const hidden = await insert(t, 'hidden')
    await t.run(async (ctx) => {
      await ctx.db.patch(hidden, { deletionRequestedAt: 1, deletedAt: 2 })
      await ctx.db.patch(poster, { deletionRequestedAt: 1 })
    })
    const result = await list(t)
    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.original.asset.asset_id).toBe('asset-visible')
    expect(result.page[0]?.renditions).toEqual({})
    expect(await get(t, 'hidden')).toBeNull()
    expect((await get(t, 'visible'))?.renditions).toEqual({})
  })

  test('resolves only the exact visible original in the configured album and Workspace', async () => {
    const t = setup()
    await insert(t, 'original')
    await insert(t, 'overwrite', {
      asset: { ...asset('original'), version_id: 'new-version' },
    })
    const args = {
      album: 'album-1',
      originalSteps: [':original'],
      renditions: {},
      workspace: 'test-workspace',
      assetId: 'asset-original',
      versionId: 'version-original',
    }
    expect(await t.query(api.lib.getStoredMedia, args)).toMatchObject({
      original: { asset: asset('original') },
      renditions: {},
    })
    for (const mismatch of [
      { album: 'another-album' },
      { workspace: 'another-workspace' },
      { assetId: 'another-asset' },
      { versionId: 'another-version' },
      { originalSteps: ['another-producer'] },
    ]) {
      expect(await t.query(api.lib.getStoredMedia, { ...args, ...mismatch })).toBeNull()
    }
    await insert(t, 'rendition', { stepName: 'encode', originalId: 'source-original' })
    expect(await get(t, 'rendition')).toBeNull()
  })

  test('applies an exclusive display cutoff to both original indexes before pagination', async () => {
    const t = setup()
    await insert(t, 'old', { createdAt: 1 })
    await insert(t, 'boundary', { createdAt: 2, stepName: 'legacy-original' })
    await insert(t, 'fresh', { createdAt: 3 })
    await insert(t, 'legacy-fresh', { createdAt: 4, stepName: 'legacy-original' })
    const args = {
      album: 'album-1',
      originalSteps: [':original', 'legacy-original'],
      renditions: {},
      createdAfter: 2,
    }
    const first = await t.query(api.lib.listStoredMedia, {
      ...args,
      paginationOpts: { numItems: 1, cursor: null },
    })
    const rest = await t.query(api.lib.listStoredMedia, {
      ...args,
      paginationOpts: { numItems: 10, cursor: first.continueCursor },
    })
    expect([...first.page, ...rest.page].map(({ original }) => original.asset.asset_id)).toEqual([
      'asset-legacy-fresh',
      'asset-fresh',
    ])
    expect(rest.isDone).toBe(true)
    // Display filtering is not access revocation or deletion of the exact-version receipt.
    expect((await get(t, 'old'))?.original.asset.asset_id).toBe('asset-old')
  })

  test('ends an all-old gallery immediately without spending pages on hidden history', async () => {
    const t = setup()
    for (let index = 0; index < 250; index += 1) {
      await insert(t, `old-${index}`, {
        createdAt: index,
        stepName: index % 2 ? ':original' : 'legacy-original',
      })
    }
    expect(
      await t.query(api.lib.listStoredMedia, {
        album: 'album-1',
        originalSteps: [':original', 'legacy-original'],
        renditions: {},
        createdAfter: 250,
        paginationOpts: { numItems: 1, cursor: null, maximumRowsRead: 2 },
      }),
    ).toMatchObject({ page: [], isDone: true })
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses a nonfinite display cutoff: %s',
    async (createdAfter) => {
      await expect(
        setup().query(api.lib.listStoredMedia, {
          album: 'album-1',
          originalSteps: [':original'],
          renditions: {},
          createdAfter,
          paginationOpts: { numItems: 1, cursor: null },
        }),
      ).rejects.toThrow('Invalid Storage media cutoff')
    },
  )

  test.each([undefined, 0])('keeps loaded ranges stable with cutoff %s', async (createdAfter) => {
    const t = setup()
    const page = (opts: PaginationOptions) => list(t, opts, createdAfter)
    for (let index = 0; index < 5; index += 1)
      await insert(t, `original-${index}`, {
        stepName: index % 2 ? ':original' : 'legacy-original',
        createdAt: index,
      })
    const first = await page({ numItems: 2, cursor: null })
    const second = await page({ numItems: 2, cursor: first.continueCursor })
    const newest = await insert(t, 'newest', { createdAt: 10 })
    const grown = await page({ numItems: 2, cursor: null, endCursor: first.continueCursor })
    expect(grown.page.map((item) => item.original._id)).toEqual([
      newest,
      ...first.page.map((item) => item.original._id),
    ])
    expect(grown.continueCursor).toBe(first.continueCursor)
    const unchanged = await page({
      numItems: 2,
      cursor: first.continueCursor,
      endCursor: second.continueCursor,
    })
    expect(unchanged.page).toEqual(second.page)
    const split = await page({
      numItems: 1,
      cursor: null,
      endCursor: first.continueCursor,
      maximumRowsRead: 2,
    })
    expect(split).toMatchObject({
      pageStatus: 'SplitRequired',
      splitCursor: expect.any(String),
      continueCursor: first.continueCursor,
    })
    const [left, right] = await Promise.all([
      page({ numItems: 1, cursor: null, endCursor: split.splitCursor }),
      page({ numItems: 1, cursor: split.splitCursor ?? null, endCursor: first.continueCursor }),
    ])
    expect([...left.page, ...right.page]).toEqual(grown.page)
    const hidden = first.page[1]?.original
    if (!hidden) throw new Error('Expected a complete original page')
    await t.run((ctx) => ctx.db.patch(hidden._id, { deletionRequestedAt: 1 }))
    expect(
      (await page({ numItems: 2, cursor: null, endCursor: first.continueCursor })).page.map(
        (item) => item.original._id,
      ),
    ).toEqual([newest, first.page[0]?.original._id])
    expect(
      (
        await page({
          numItems: 2,
          cursor: first.continueCursor,
          endCursor: second.continueCursor,
        })
      ).page,
    ).toEqual(second.page)
  })

  test('bounds producer fanout and refuses invalid page limits and foreign cursors', async () => {
    const t = setup()
    await insert(t, 'original')
    const args = {
      album: 'album-1',
      originalSteps: [':original'],
      renditions: {},
      paginationOpts: { numItems: 1, cursor: null },
    }
    const invalidProducers: { originalSteps?: string[]; renditions?: Record<string, string> }[] = [
      { originalSteps: [] },
      { originalSteps: [''] },
      { originalSteps: ['1', '2', '3', '4', '5'] },
      { renditions: { a: 'encode', b: 'encode', c: 'encode', d: 'encode', e: 'encode' } },
      { renditions: { playback: ':original' } },
      { renditions: { playback: '' } },
    ]
    for (const producers of invalidProducers) {
      await expect(t.query(api.lib.listStoredMedia, { ...args, ...producers })).rejects.toThrow(
        'Invalid Storage media producers',
      )
      const { paginationOpts: _paginationOpts, ...config } = args
      await expect(
        t.query(api.lib.getStoredMedia, {
          ...config,
          ...producers,
          workspace: 'test-workspace',
          assetId: 'asset-original',
          versionId: 'version-original',
        }),
      ).rejects.toThrow('Invalid Storage media producers')
    }
    await expect(list(t, { numItems: Number.NaN, cursor: null })).rejects.toThrow('page limits')
    await expect(list(t, { numItems: 1, cursor: '[1,2]' })).rejects.toThrow('InvalidCursor')
    const first = await list(t, { numItems: 1, cursor: null })
    await expect(
      t.query(api.lib.listStoredMedia, {
        ...args,
        album: 'another-album',
        paginationOpts: { numItems: 1, cursor: first.continueCursor },
      }),
    ).rejects.toThrow('InvalidCursor')
  })

  test('caps requested pages and reactive growth before joining renditions', async () => {
    const t = setup()
    for (let index = 0; index < 105; index += 1)
      await insert(t, `original-${index}`, { createdAt: index })
    const first = await list(t, { numItems: 1000, cursor: null })
    expect(first.page).toHaveLength(100)
    expect(first.isDone).toBe(false)
    for (let index = 0; index < 101; index += 1)
      await insert(t, `new-${index}`, { createdAt: 1000 + index })
    const grown = await list(t, {
      numItems: 1000,
      cursor: null,
      endCursor: first.continueCursor,
      maximumRowsRead: 1000,
    })
    expect(grown.page).toHaveLength(200)
    expect(grown).toMatchObject({
      pageStatus: 'SplitRequired',
      splitCursor: expect.any(String),
      continueCursor: first.continueCursor,
    })
  })
})
