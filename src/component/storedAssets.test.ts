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

describe('stored asset reads and deletion ledger', () => {
  const seed = async (count: number) => {
    const t = convexTest(schema, modules)
    const results = Array.from({ length: count }, (_, index) => receipt(`n${index}`))
    await t.action(api.lib.handleWebhook, { ...signed(completed({ stored: results })), storage })
    return t
  }

  test('reads exact visible versions and pages through an album', async () => {
    const t = await seed(5)
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
    const first = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 3, cursor: null },
    })
    const second = await t.query(api.lib.listStoredAssets, {
      album: 'wedding-gallery',
      paginationOpts: { numItems: 3, cursor: first.continueCursor },
    })
    expect(first.page).toHaveLength(3)
    expect(second.page).toHaveLength(2)
    expect(second.isDone).toBe(true)
    const other = await t.query(api.lib.listStoredAssets, {
      album: 'another-album',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(other.page).toHaveLength(0)
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
