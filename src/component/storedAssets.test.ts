/// <reference types="vite/client" />

import { createHmac } from 'node:crypto'
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { selectStoredAssets } from '../shared/storedAssets.ts'
import { api } from './_generated/api.ts'
import schema from './schema.ts'
import { modules } from './setup.test.ts'

process.env.TRANSLOADIT_KEY = 'test-key'
process.env.TRANSLOADIT_SECRET = 'test-secret'

const workspace = 'open-test-prod'
const storage = { workspace }
// Canonical API2 identifiers: 21 URL-safe characters and a final A/Q/g/w.
const damId = (seed: string) => `${seed.padEnd(21, 'x').slice(0, 21)}A`

const receipt = (seed: string, overrides: Record<string, unknown> = {}) => ({
  id: `result-${seed}`,
  workspace,
  asset_id: damId(`asset${seed}`),
  version_id: damId(`version${seed}`),
  path: `uploads/upload-1/${seed}.jpg`,
  size: 1234,
  mime: 'image/jpeg',
  md5hash: 'c6c5215913b57ac1bdc0109cb5676cb5',
  width: 1600,
  height: 1067,
  thumbhash: 'AAAAAAAA',
  original_id: `original-${seed}`,
  ...overrides,
})

const completed = (results: Record<string, unknown[]>, extra: Record<string, unknown> = {}) => ({
  assembly_id: 'assembly-1',
  ok: 'ASSEMBLY_COMPLETED',
  fields: { album: 'wedding-gallery', userId: 'guest-1', uploadId: 'upload-1' },
  results,
  ...extra,
})

const signed = (payload: unknown) => {
  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha384', 'test-secret').update(rawBody).digest('hex')
  return { rawBody, signature: `sha384:${signature}`, payload }
}

describe('selectStoredAssets', () => {
  test('keeps canonical receipts with provenance and skips ordinary results', () => {
    const selected = selectStoredAssets(
      completed({
        images_resized: [{ id: 'temporary', ssl_url: 'https://tmp.example.com/a.jpg' }],
        stored: [receipt('a'), receipt('b', { original_id: ['one', null] })],
      }) as never,
      storage,
    )
    expect(selected).toEqual([
      expect.objectContaining({
        assemblyId: 'assembly-1',
        stepName: 'stored',
        resultId: 'result-a',
        originalId: 'original-a',
        asset: expect.objectContaining({ asset_id: damId('asseta'), width: 1600 }),
      }),
      expect.objectContaining({ resultId: 'result-b', originalId: ['one', null] }),
    ])
    // Only canonical receipt fields are persisted, never result ids or temporary URLs.
    expect(Object.keys(selected[0]?.asset ?? {})).not.toContain('id')
  })

  test.each([
    ['a partial Storage record', { stored: [{ id: 'partial', asset_id: damId('partial') }] }],
    ['a cross-Workspace receipt', { stored: [receipt('a', { workspace: 'another' })] }],
    ['a receipt without a result id', { stored: [receipt('a', { id: undefined })] }],
    ['an invalid original id', { stored: [receipt('a', { original_id: 42 })] }],
  ])('fails the whole batch for %s', (_label, results) => {
    expect(() =>
      selectStoredAssets(completed({ ok: [receipt('ok')], ...results }) as never, storage),
    ).toThrow('invalid or cross-Workspace')
  })

  test.each([
    ['unfinished', { ok: 'ASSEMBLY_EXECUTING' }, 'not complete'],
    ['failed', { error: 'ROBOT_FAILED' }, 'not complete (ROBOT_FAILED)'],
    ['result-less', { results: undefined }, 'did not contain results'],
  ])('rejects an %s Assembly', (_label, extra, message) => {
    expect(() => selectStoredAssets(completed({}, extra) as never, storage)).toThrow(message)
  })
})

describe('stored asset ingestion', () => {
  test('registers verified receipts once, however often the notification is replayed', async () => {
    const t = convexTest(schema, modules)
    const body = signed(completed({ stored: [receipt('a'), receipt('b')] }))
    for (let replay = 0; replay < 3; replay += 1) {
      const result = await t.action(api.lib.handleWebhook, { ...body, storage })
      expect(result.storedAssetCount).toBe(2)
    }
    const rows = await t.run((ctx) => ctx.db.query('storedAssets').collect())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      album: 'wedding-gallery',
      userId: 'guest-1',
      uploadId: 'upload-1',
      assemblyId: 'assembly-1',
      stepName: 'stored',
    })
  })

  test('queued notifications carry the Storage configuration to processing', async () => {
    vi.useFakeTimers()
    try {
      const t = convexTest(schema, modules)
      await t.action(api.lib.queueWebhook, {
        ...signed(completed({ stored: [receipt('a')] })),
        storage,
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(await t.run((ctx) => ctx.db.query('storedAssets').collect())).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('ignores receipts without Storage configuration and of unfinished Assemblies', async () => {
    const t = convexTest(schema, modules)
    await t.action(api.lib.handleWebhook, signed(completed({ stored: [receipt('a')] })))
    await t.action(api.lib.handleWebhook, {
      ...signed(completed({ stored: [receipt('b')] }, { ok: 'ASSEMBLY_EXECUTING' })),
      storage,
    })
    expect(await t.run((ctx) => ctx.db.query('storedAssets').collect())).toHaveLength(0)
  })

  test('an invalid receipt persists nothing from that status update', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.action(api.lib.handleWebhook, {
        ...signed(completed({ stored: [receipt('a'), receipt('b', { workspace: 'another' })] })),
        storage,
      }),
    ).rejects.toThrow('cross-Workspace')
    expect(await t.query(api.lib.getAssemblyStatus, { assemblyId: 'assembly-1' })).toBeNull()
    expect(await t.run((ctx) => ctx.db.query('storedAssets').collect())).toHaveLength(0)
  })

  test('an authoritative refresh registers receipts too', async () => {
    const t = convexTest(schema, modules)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(completed({ stored: [receipt('a')] }))),
    )
    try {
      const result = await t.action(api.lib.refreshAssembly, { assemblyId: 'assembly-1', storage })
      expect(result.storedAssetCount).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('council regressions', () => {
  test('a completed Assembly without results still records its status', async () => {
    const t = convexTest(schema, modules)
    const result = await t.action(api.lib.handleWebhook, {
      ...signed(completed({}, { results: undefined })),
      storage,
    })
    expect(result).toMatchObject({ assemblyId: 'assembly-1', storedAssetCount: 0 })
    expect(await t.query(api.lib.getAssemblyStatus, { assemblyId: 'assembly-1' })).not.toBeNull()
  })

  test('receipts without an album can still be hidden and deleted', async () => {
    const t = convexTest(schema, modules)
    await t.action(api.lib.handleWebhook, {
      ...signed({ ...completed({ stored: [receipt('loose')] }), fields: {} }),
      storage,
    })
    const request = await t.mutation(api.lib.requestStoredAssetDeletion, {
      createdBefore: Date.now() + 1,
    })
    expect(request.requested).toEqual([{ workspace, assetId: damId('assetloose') }])
    const pending = await t.query(api.lib.listStoredAssetDeletions, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(pending.page.map((entry) => entry.assetId)).toEqual([damId('assetloose')])
  })

  test('an Assembly listing skips hidden versions before applying its limit', async () => {
    const t = await (async () => {
      const t = convexTest(schema, modules)
      await t.action(api.lib.handleWebhook, {
        ...signed(completed({ stored: [receipt('x'), receipt('y'), receipt('z')] })),
        storage,
      })
      return t
    })()
    const [first, second] = await t.query(api.lib.listStoredAssetsForAssembly, {
      assemblyId: 'assembly-1',
    })
    for (const row of [first, second]) {
      await t.mutation(api.lib.requestStoredAssetDeletion, {
        album: 'wedding-gallery',
        createdBefore: Date.now() + 1,
        limit: 1,
      })
      expect(row).toBeDefined()
    }
    const visible = await t.query(api.lib.listStoredAssetsForAssembly, {
      assemblyId: 'assembly-1',
      limit: 1,
    })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.deletionRequestedAt).toBeUndefined()
  })
})

describe('expiry keeps assets with a fresh version', () => {
  const at = async (t: ReturnType<typeof convexTest>, time: number, seeds: [string, string][]) => {
    vi.setSystemTime(time)
    await t.action(api.lib.handleWebhook, {
      ...signed({
        ...completed({
          stored: seeds.map(([asset, version]) =>
            receipt(asset, { asset_id: damId(`asset${asset}`), version_id: damId(version) }),
          ),
        }),
        assembly_id: `assembly-${time}`,
      }),
      storage,
    })
  }
  const requestAll = async (t: ReturnType<typeof convexTest>, createdBefore: number) => {
    const requested: string[] = []
    let cursor: string | undefined
    for (let call = 0; call < 20; call += 1) {
      const result: {
        requested: { assetId: string }[]
        hasMore: boolean
        continueCursor: string
      } = await t.mutation(api.lib.requestStoredAssetDeletion, {
        album: 'wedding-gallery',
        createdBefore,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      })
      requested.push(...result.requested.map((entry) => entry.assetId))
      if (!result.hasMore) return requested
      cursor = result.continueCursor
    }
    throw new Error('expiry scanning did not finish')
  }

  test('an old version does not expire an asset overwritten after the cutoff', async () => {
    vi.useFakeTimers()
    try {
      const t = convexTest(schema, modules)
      await at(t, 1_000, [['kept', 'v1old']])
      await at(t, 9_000, [['kept', 'v2fresh']])
      expect(await requestAll(t, 5_000)).toEqual([])
      const page = await t.query(api.lib.listStoredAssets, {
        album: 'wedding-gallery',
        paginationOpts: { numItems: 10, cursor: null },
      })
      expect(page.page.map((row) => row.asset.version_id).sort()).toEqual(
        [damId('v1old'), damId('v2fresh')].sort(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('skipped fresh assets never stall later eligible ones', async () => {
    vi.useFakeTimers()
    try {
      const t = convexTest(schema, modules)
      await at(t, 1_000, [
        ['a', 'a1'],
        ['b', 'b1'],
        ['c', 'c1'],
      ])
      await at(t, 2_000, [['expired', 'e1']])
      await at(t, 9_000, [
        ['a', 'a2'],
        ['b', 'b2'],
        ['c', 'c2'],
      ])
      expect(await requestAll(t, 5_000)).toEqual([damId('assetexpired')])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('council 3 regressions', () => {
  test('orphans adopted for deletion never come back through a late notification', async () => {
    const t = convexTest(schema, modules)
    const orphan = receipt('orphan')
    const { id: _id, original_id: _originalId, ...asset } = orphan
    const adopted = await t.mutation(api.lib.adoptStoredAssetsForDeletion, {
      album: 'wedding-gallery',
      assets: [asset],
    })
    expect(adopted).toEqual({ adopted: 1, alreadyKnown: 0 })
    await t.action(api.lib.handleWebhook, { ...signed(completed({ stored: [orphan] })), storage })
    const page = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toEqual([])
    const pending = await t.query(api.lib.listStoredAssetDeletions, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(pending.page.map((entry) => entry.assetId)).toEqual([damId('assetorphan')])
  })

  test('a frozen page that outgrows the read limit splits without skipping a row', async () => {
    const t = convexTest(schema, modules)
    const first = Array.from({ length: 5 }, (_, index) => receipt(`old${index}`))
    await t.action(api.lib.handleWebhook, {
      ...signed({ ...completed({ stored: first }), assembly_id: 'assembly-old' }),
      storage,
    })
    const oldest = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 5, cursor: null },
    })
    const newer = Array.from({ length: 1050 }, (_, index) => receipt(`new${index}`))
    for (let batch = 0; batch < newer.length; batch += 350) {
      await t.action(api.lib.handleWebhook, {
        ...signed({
          ...completed({ stored: newer.slice(batch, batch + 350) }),
          assembly_id: `a${batch}`,
        }),
        storage,
      })
    }
    let splits = 0
    // Split the way convex-helpers' usePaginatedQuery does, until every range fits one read.
    const read = async (range: { cursor: string | null; endCursor: string }): Promise<string[]> => {
      const result = await t.query(api.lib.listStoredAssets, {
        album: 'wedding-gallery',
        // A client cannot raise the bound on rows read.
        paginationOpts: { numItems: 5, maximumRowsRead: 100_000, ...range },
      })
      expect(result.page.length).toBeLessThanOrEqual(1000)
      if (result.pageStatus !== 'SplitRequired') return result.page.map((row) => row._id)
      const { splitCursor } = result
      if (!splitCursor) throw new Error('expected a split cursor')
      splits += 1
      return [
        ...(await read({ cursor: range.cursor, endCursor: splitCursor })),
        ...(await read({ cursor: splitCursor, endCursor: result.continueCursor })),
      ]
    }
    const ids = await read({ cursor: null, endCursor: oldest.continueCursor })
    expect(splits).toBeGreaterThan(0)
    expect(ids).toHaveLength(1055)
    expect(new Set(ids).size).toBe(1055)
    // NaN passes Math.min and Math.max; with an end cursor it would lift the read limit entirely.
    await expect(
      t.query(api.lib.listStoredAssets, {
        album: 'wedding-gallery',
        paginationOpts: {
          numItems: 5,
          maximumRowsRead: Number.NaN,
          cursor: null,
          endCursor: oldest.continueCursor,
        },
      }),
    ).rejects.toThrow('Invalid Storage page limits')
  })
})

describe('stored asset reads and deletion ledger', () => {
  const seed = async (count: number) => {
    const t = convexTest(schema, modules)
    const results = Array.from({ length: count }, (_, index) => receipt(`n${index}`))
    await t.action(api.lib.handleWebhook, { ...signed(completed({ stored: results })), storage })
    return t
  }

  test('reads exact visible versions', async () => {
    const t = await seed(3)
    const exact = await t.query(api.lib.getStoredAsset, {
      workspace,
      assetId: damId('assetn1'),
      versionId: damId('versionn1'),
    })
    expect(exact?.asset.path).toBe('uploads/upload-1/n1.jpg')
    for (const [assetId, versionId] of [
      [damId('assetn1'), damId('versionn2')],
      [damId('missing'), damId('versionn1')],
    ] as const) {
      expect(await t.query(api.lib.getStoredAsset, { workspace, assetId, versionId })).toBeNull()
    }
  })

  const pageThrough = async (
    t: Awaited<ReturnType<typeof seed>>,
    numItems: number,
    album = 'wedding-gallery',
  ) => {
    const ids: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 100; guard += 1) {
      const result: { page: { _id: string }[]; isDone: boolean; continueCursor: string } =
        await t.query(api.lib.listStoredAssets, { album, paginationOpts: { numItems, cursor } })
      ids.push(...result.page.map((row) => row._id))
      if (result.isDone) return ids
      cursor = result.continueCursor
    }
    throw new Error('pagination did not finish')
  }

  test('pages newest first across rows registered in the same instant', async () => {
    // Seven receipts from one notification share createdAt; three more arrive later.
    const t = await seed(7)
    await t.action(api.lib.handleWebhook, {
      ...signed({
        ...completed({ stored: ['p', 'q', 'r'].map((seedName) => receipt(seedName)) }),
        assembly_id: 'assembly-2',
      }),
      storage,
    })
    const all = await t.run((ctx) =>
      ctx.db
        .query('storedAssets')
        .withIndex('by_album_visibility', (q) =>
          q.eq('album', 'wedding-gallery').eq('deletionRequestedAt', undefined),
        )
        .order('desc')
        .collect(),
    )
    for (const numItems of [1, 2, 3, 7, 10, 50]) {
      expect(await pageThrough(t, numItems)).toEqual(all.map((row) => row._id))
    }
    expect(await pageThrough(t, 3, 'another-album')).toEqual([])
  })

  test('reaches every record beyond a 500-row page without rereading earlier pages', async () => {
    const t = convexTest(schema, modules)
    for (let batch = 0; batch < 3; batch += 1) {
      const results = Array.from({ length: 400 }, (_, index) => receipt(`b${batch}n${index}`))
      await t.action(api.lib.handleWebhook, {
        ...signed({ ...completed({ stored: results }), assembly_id: `assembly-${batch}` }),
        storage,
      })
    }
    const ids = await pageThrough(t, 500)
    expect(ids).toHaveLength(1200)
    expect(new Set(ids).size).toBe(1200)
    const capped = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 5000, cursor: null },
    })
    expect(capped.page).toHaveLength(500)
    // A NaN page size would read the whole album in one query; non-finite limits are refused.
    for (const limits of [
      { numItems: Number.NaN },
      { numItems: 5, maximumRowsRead: Number.NaN },
      { numItems: Number.POSITIVE_INFINITY },
    ]) {
      await expect(
        t.query(api.lib.listStoredAssets, {
          album: 'wedding-gallery',
          paginationOpts: { ...limits, cursor: null },
        }),
      ).rejects.toThrow('Invalid Storage page limits')
    }
  })

  test('an end cursor keeps a loaded page stable while newer photos arrive', async () => {
    const t = await seed(5)
    const first = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 2, cursor: null },
    })
    const second = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    })
    await t.action(api.lib.handleWebhook, {
      ...signed({ ...completed({ stored: [receipt('newest')] }), assembly_id: 'assembly-late' }),
      storage,
    })
    const grown = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 2, cursor: null, endCursor: first.continueCursor },
    })
    const unchanged = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: {
        numItems: 2,
        cursor: first.continueCursor,
        endCursor: second.continueCursor,
      },
    })
    expect(grown.page.map((row) => row.asset.asset_id)).toEqual([
      damId('assetnewest'),
      ...first.page.map((row) => row.asset.asset_id),
    ])
    expect(grown.continueCursor).toBe(first.continueCursor)
    expect(unchanged.page.map((row) => row._id)).toEqual(second.page.map((row) => row._id))
    expect(unchanged.isDone).toBe(false)
  })

  test('hiding a photo shrinks only the loaded page that held it', async () => {
    const t = await seed(5)
    const list = (range: { cursor: string | null; endCursor?: string }) =>
      t.query(api.lib.listStoredAssets, {
        album: 'wedding-gallery',
        paginationOpts: { numItems: 2, ...range },
      })
    const first = await list({ cursor: null })
    const second = await list({ cursor: first.continueCursor })
    // Hide the row the first page's cursor points at.
    const [kept, hidden] = first.page
    if (!kept || !hidden) throw new Error('expected a full first page')
    await t.run((ctx) => ctx.db.patch(hidden._id, { deletionRequestedAt: Date.now() }))
    const pinned = await list({ cursor: null, endCursor: first.continueCursor })
    const next = await list({ cursor: first.continueCursor, endCursor: second.continueCursor })
    expect(pinned.page.map((row) => row._id)).toEqual([kept._id])
    expect(next.page.map((row) => row._id)).toEqual(second.page.map((row) => row._id))
  })

  test('refuses cursors from another album or an earlier release, so clients restart', async () => {
    const t = await seed(3)
    const list = (
      album: string,
      range: { cursor: string | null; endCursor?: string; maximumRowsRead?: number },
    ) => t.query(api.lib.listStoredAssets, { album, paginationOpts: { numItems: 1, ...range } })
    const first = await list('wedding-gallery', { cursor: null })
    const [row] = first.page
    if (!row) throw new Error('expected a row')
    // Earlier releases paged by [createdAt, _creationTime].
    const released = JSON.stringify([row.createdAt, row._creationTime])
    for (const cursor of ['not json', '[]', '{}', '[1]', '["a", 2]', released]) {
      await expect(list('wedding-gallery', { cursor })).rejects.toThrow('InvalidCursor')
      await expect(list('wedding-gallery', { cursor: null, endCursor: cursor })).rejects.toThrow(
        'InvalidCursor',
      )
    }
    await expect(list('another-album', { cursor: first.continueCursor })).rejects.toThrow(
      'InvalidCursor',
    )
    // A tiny read bound from a client cannot turn an ordinary page into a split.
    const next = await list('wedding-gallery', {
      cursor: first.continueCursor,
      maximumRowsRead: 1,
    })
    expect(next.page).toHaveLength(1)
    expect(next.pageStatus ?? null).toBeNull()
  })

  test('deletion ledger cursors stay in their album, also for receipts without one', async () => {
    const t = convexTest(schema, modules)
    const seeds = ['l1', 'l2', 'l3']
    await t.action(api.lib.handleWebhook, {
      ...signed({
        ...completed({ stored: seeds.map((seedName) => receipt(seedName)) }),
        fields: {},
      }),
      storage,
    })
    await t.mutation(api.lib.requestStoredAssetDeletion, { createdBefore: Date.now() + 1 })
    const pending = (cursor: string | null, album?: string) =>
      t.query(api.lib.listStoredAssetDeletions, {
        ...(album ? { album } : {}),
        paginationOpts: { numItems: 1, cursor },
      })
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const result: Awaited<ReturnType<typeof pending>> = await pending(cursor)
      seen.push(...result.page.map((entry) => entry.assetId))
      if (result.isDone) break
      cursor = result.continueCursor
    }
    expect(seen.sort()).toEqual(seeds.map((seedName) => damId(`asset${seedName}`)).sort())
    // A cursor over receipts without an album encodes that absence; no album accepts it.
    const first = await pending(null)
    await expect(pending(first.continueCursor, 'wedding-gallery')).rejects.toThrow('InvalidCursor')
    const [row] = await t.run((ctx) => ctx.db.query('storedAssets').collect())
    const released = JSON.stringify([row?.deletionRequestedAt, row?._creationTime])
    await expect(pending(released)).rejects.toThrow('InvalidCursor')
  })

  test('hides requested deletions at once and keeps references until Storage confirms', async () => {
    const t = await seed(3)
    const request = await t.mutation(api.lib.requestStoredAssetDeletion, {
      album: 'wedding-gallery',
      createdBefore: Date.now() + 1,
      limit: 2,
    })
    expect(request.requested).toHaveLength(2)
    expect(request.hasMore).toBe(true)
    const [first] = request.requested
    if (!first) throw new Error('expected a requested deletion')
    const visible = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(visible.page).toHaveLength(1)
    const hidden = await t.run((ctx) => ctx.db.query('storedAssets').collect())
    const hiddenRow = hidden.find((row) => row.asset.asset_id === first.assetId)
    expect(
      await t.query(api.lib.getStoredAsset, {
        workspace,
        assetId: first.assetId,
        versionId: hiddenRow?.asset.version_id ?? '',
      }),
    ).toBeNull()

    await t.mutation(api.lib.failStoredAssetDeletion, { ...first, error: 'HTTP 503' })
    const pendingPage = (numItems = 10) =>
      t.query(api.lib.listStoredAssetDeletions, {
        album: 'wedding-gallery',
        paginationOpts: { numItems, cursor: null },
      })
    const pending = (await pendingPage()).page
    expect(pending).toHaveLength(2)
    expect(pending.find((entry) => entry.assetId === first.assetId)).toMatchObject({
      deletionAttempts: 1,
      deletionError: 'HTTP 503',
      rows: 1,
    })

    expect(await t.mutation(api.lib.completeStoredAssetDeletion, first)).toEqual({ deleted: 1 })
    expect((await pendingPage()).page).toHaveLength(1)
    // The completed version stays as a tombstone without image data, never as a visible row.
    const tombstone = (await t.run((ctx) => ctx.db.query('storedAssets').collect())).find(
      (row) => row.asset.asset_id === first.assetId,
    )
    expect(tombstone).toMatchObject({ deletedAt: expect.any(Number), deletionAttempts: 1 })
    expect(tombstone?.asset.thumbhash).toBeUndefined()
    expect(tombstone?.deletionError).toBeUndefined()
    expect(await t.mutation(api.lib.completeStoredAssetDeletion, first)).toEqual({ deleted: 0 })
  })

  test("pages through one album's pending deletions only", async () => {
    const t = convexTest(schema, modules)
    for (const [album, seeds] of [
      ['wedding-gallery', ['a', 'b', 'c']],
      ['another-album', ['x']],
    ] as const) {
      await t.action(api.lib.handleWebhook, {
        ...signed({
          ...completed({ stored: seeds.map((seedName) => receipt(seedName)) }),
          assembly_id: `assembly-${album}`,
          fields: { album },
        }),
        storage,
      })
      await t.mutation(api.lib.requestStoredAssetDeletion, { album, createdBefore: Date.now() + 1 })
    }
    const first = await t.query(api.lib.listStoredAssetDeletions, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 2, cursor: null },
    })
    const second = await t.query(api.lib.listStoredAssetDeletions, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    })
    expect([...first.page, ...second.page].map((entry) => entry.assetId).sort()).toEqual(
      ['a', 'b', 'c'].map((seedName) => damId(`asset${seedName}`)).sort(),
    )
    expect(second.isDone).toBe(true)
    await expect(
      t.query(api.lib.listStoredAssetDeletions, {
        album: 'wedding-gallery',
        paginationOpts: { numItems: Number.NaN, cursor: null },
      }),
    ).rejects.toThrow('Invalid Storage page limits')
  })

  test('refuses to complete a deletion that was never requested', async () => {
    const t = await seed(1)
    await expect(
      t.mutation(api.lib.completeStoredAssetDeletion, { workspace, assetId: damId('assetn0') }),
    ).rejects.toThrow('Request deletion before completing it')
    expect(await t.run((ctx) => ctx.db.query('storedAssets').collect())).toHaveLength(1)
  })

  test('a delayed replay after a completed deletion does not bring the photo back', async () => {
    const t = await seed(1)
    await t.mutation(api.lib.requestStoredAssetDeletion, {
      album: 'wedding-gallery',
      createdBefore: Date.now() + 1,
    })
    const deletedAsset = { workspace, assetId: damId('assetn0') }
    await t.mutation(api.lib.completeStoredAssetDeletion, deletedAsset)
    // The same verified notification arrives late, and so does a newer version of that asset.
    for (const replay of [receipt('n0'), receipt('n0', { version_id: damId('newerversion') })]) {
      await t.action(api.lib.handleWebhook, {
        ...signed(completed({ stored: [replay] })),
        storage,
      })
    }
    const page = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toHaveLength(0)
    expect(
      await t.query(api.lib.getStoredAsset, {
        ...deletedAsset,
        versionId: damId('versionn0'),
      }),
    ).toBeNull()
    const pending = await t.query(api.lib.listStoredAssetDeletions, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(pending.page).toEqual([])
  })

  test('a replayed notification does not resurrect a hidden version', async () => {
    const t = await seed(1)
    await t.mutation(api.lib.requestStoredAssetDeletion, {
      album: 'wedding-gallery',
      createdBefore: Date.now() + 1,
    })
    await t.action(api.lib.handleWebhook, {
      ...signed(completed({ stored: [receipt('n0')] })),
      storage,
    })
    const page = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toHaveLength(0)
  })
})
