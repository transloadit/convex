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

const list = (t: Test, paginationOpts: PaginationOptions = { numItems: 10, cursor: null }) =>
  t.query(api.lib.listStoredMedia, {
    album: 'album-1',
    originalSteps: [':original', 'legacy-original'],
    renditions: { playback: 'encode', poster: 'poster' },
    paginationOpts,
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
    await t.run((ctx) => ctx.db.patch(original, { originalId: ['source-original', 'second'] }))
    expect((await list(t)).page[0]?.renditions).toEqual({})
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
  })

  test('keeps loaded ranges stable across inserts, deletions and required page splits', async () => {
    const t = setup()
    for (let index = 0; index < 5; index += 1)
      await insert(t, `original-${index}`, {
        stepName: index % 2 ? ':original' : 'legacy-original',
        createdAt: index,
      })
    const first = await list(t, { numItems: 2, cursor: null })
    const second = await list(t, { numItems: 2, cursor: first.continueCursor })
    const newest = await insert(t, 'newest', { createdAt: 10 })
    const grown = await list(t, { numItems: 2, cursor: null, endCursor: first.continueCursor })
    expect(grown.page.map((item) => item.original._id)).toEqual([
      newest,
      ...first.page.map((item) => item.original._id),
    ])
    expect(grown.continueCursor).toBe(first.continueCursor)
    const unchanged = await list(t, {
      numItems: 2,
      cursor: first.continueCursor,
      endCursor: second.continueCursor,
    })
    expect(unchanged.page).toEqual(second.page)
    const split = await list(t, {
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
      list(t, { numItems: 1, cursor: null, endCursor: split.splitCursor }),
      list(t, { numItems: 1, cursor: split.splitCursor ?? null, endCursor: first.continueCursor }),
    ])
    expect([...left.page, ...right.page]).toEqual(grown.page)
    const hidden = first.page[1]?.original
    if (!hidden) throw new Error('Expected a complete original page')
    await t.run((ctx) => ctx.db.patch(hidden._id, { deletionRequestedAt: 1 }))
    expect(
      (await list(t, { numItems: 2, cursor: null, endCursor: first.continueCursor })).page.map(
        (item) => item.original._id,
      ),
    ).toEqual([newest, first.page[0]?.original._id])
    expect(
      (
        await list(t, {
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
    for (const producers of invalidProducers)
      await expect(t.query(api.lib.listStoredMedia, { ...args, ...producers })).rejects.toThrow(
        'Invalid Storage media producers',
      )
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
