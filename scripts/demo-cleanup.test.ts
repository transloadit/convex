// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import {
  type CleanupConvex,
  type CleanupR2,
  type CleanupStorage,
  runDemoCleanup,
} from './demo-cleanup.ts'

const hour = 60 * 60 * 1000
const now = 100 * hour
const prefix = 'convex-demo/demo-deployment/wedding-gallery/'

type Row = { assetId: string; path: string; createdAt: number; hidden: boolean; attempts: number }

// An in-memory stand-in for the component ledger, with the same hide/complete/fail and paging rules.
const fakeConvex = (rows: Row[]) => {
  const calls: string[] = []
  const convex: CleanupConvex = {
    summary: async ({ createdBefore }) => ({
      visibleStoredAssets: rows.filter((row) => !row.hidden).length,
      expiredStoredAssets: rows.filter((row) => !row.hidden && row.createdAt < createdBefore)
        .length,
      results: 3,
      truncated: false,
      storagePrefix: prefix,
    }),
    requestStorageDeletion: async ({ createdBefore, limit, cursor }) => {
      calls.push(cursor ? `hide:${cursor}` : 'hide')
      const start = cursor === undefined ? 0 : Number(cursor)
      const scanned = rows.slice(start, start + limit)
      const expired = scanned.filter((row) => !row.hidden && row.createdAt < createdBefore)
      for (const row of expired) row.hidden = true
      return {
        requested: expired.map((row) => ({ workspace: 'w', assetId: row.assetId })),
        hasMore: start + limit < rows.length,
        continueCursor: String(start + limit),
      }
    },
    // Like the component, pages continue after a stable position rather than an array offset.
    pendingStorageDeletions: async ({ cursor, numItems }) => {
      const pending = rows
        .filter((row) => row.hidden && (cursor === null || row.assetId > cursor))
        .sort((a, b) => a.assetId.localeCompare(b.assetId))
      const page = pending.slice(0, numItems)
      return {
        page: page.map((row) => ({
          workspace: 'w',
          assetId: row.assetId,
          paths: [row.path],
          deletionAttempts: row.attempts,
        })),
        isDone: pending.length <= numItems,
        continueCursor: page[page.length - 1]?.assetId ?? cursor ?? '',
      }
    },
    completeStorageDeletion: async ({ assetId }) => {
      calls.push(`complete:${assetId}`)
      rows.splice(
        rows.findIndex((row) => row.assetId === assetId),
        1,
      )
    },
    failStorageDeletion: async ({ assetId, error }) => {
      calls.push(`fail:${assetId}:${error}`)
      const row = rows.find((candidate) => candidate.assetId === assetId)
      if (row) row.attempts += 1
    },
    adoptForDeletion: async (assets) => {
      calls.push(`adopt:${assets.map((asset) => asset.asset_id).join(',')}`)
      let adopted = 0
      for (const asset of assets) {
        const known = rows.filter((row) => row.assetId === asset.asset_id)
        for (const row of known) row.hidden = true
        if (known.length === 0) {
          rows.push({
            assetId: asset.asset_id,
            path: asset.path,
            createdAt: 0,
            hidden: true,
            attempts: 0,
          })
          adopted += 1
        }
      }
      return { adopted, alreadyKnown: assets.length - adopted }
    },
    purgeAlbum: async () => {
      calls.push('purge')
      return { deletedResults: 3, deletedAssemblies: 1 }
    },
  }
  return { convex, calls }
}

const fakeStorage = (
  objects: string[],
  { failing = new Set<string>(), moved = new Map<string, string>() } = {},
) => {
  const deleted: string[] = []
  const exists = (assetId: string) => objects.includes(assetId) && !deleted.includes(assetId)
  const storage: CleanupStorage = {
    workspace: 'w',
    list: async (listPrefix) =>
      objects
        .filter(exists)
        .map((assetId) => ({
          workspace: 'w',
          asset_id: assetId,
          version_id: `${assetId}-v1`,
          path: moved.get(assetId) ?? `${prefix}${assetId}.jpg`,
          size: 1,
          mime: 'image/jpeg',
        }))
        .filter((object) => object.path.startsWith(listPrefix)),
    currentPath: async (assetId) =>
      exists(assetId) ? (moved.get(assetId) ?? `${prefix}${assetId}.jpg`) : null,
    delete: async (assetId) => {
      if (failing.has(assetId)) throw Object.assign(new Error('HTTP 503'), { code: 'HTTP_503' })
      if (!exists(assetId))
        throw Object.assign(new Error('gone'), { code: 'DAM_RESOURCE_NOT_FOUND' })
      deleted.push(assetId)
    },
  }
  return { storage, deleted }
}

const row = (assetId: string, ageHours: number, path = `${prefix}${assetId}.jpg`): Row => ({
  assetId,
  path,
  createdAt: now - ageHours * hour,
  hidden: false,
  attempts: 0,
})

const expire = { dryRun: false, olderThanMs: hour, now }

describe('demo cleanup', () => {
  test('a dry run reports every backend and changes nothing', async () => {
    const rows = [row('old', 30), row('new', 1)]
    const { convex, calls } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['old', 'new', 'orphan'])
    const r2: CleanupR2 = { list: async () => ['wedding/a.jpg'], delete: vi.fn() }
    const report = await runDemoCleanup({ convex, storage, r2 }, { dryRun: true, now })
    expect(report).toMatchObject({
      dryRun: true,
      mode: 'reset',
      convex: { visibleStoredAssets: 2, results: 3 },
      storage: { objects: 3, wouldHide: 2, prefix },
      r2: { objects: 1 },
    })
    expect(calls).toEqual([])
    expect(deleted).toEqual([])
    expect(r2.delete).not.toHaveBeenCalled()
    expect(rows.every((candidate) => !candidate.hidden)).toBe(true)
  })

  test('expiry hides old photos, deletes their bytes, then records the deletion', async () => {
    const rows = [row('old', 30), row('new', 1)]
    const { convex, calls } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['old', 'new'])
    const report = await runDemoCleanup(
      { convex, storage },
      { dryRun: false, olderThanMs: 24 * hour, now },
    )
    expect(report).toMatchObject({
      mode: 'expire',
      storage: { hidden: 1, deleted: 1 },
      r2: 'unchanged',
      retryNeeded: false,
    })
    expect(deleted).toEqual(['old'])
    expect(rows.map((candidate) => candidate.assetId)).toEqual(['new'])
    expect(calls).toEqual(['hide', 'complete:old'])
  })

  test('never deletes or releases an asset whose receipt lies outside this deployment', async () => {
    const rows = [row('foreign', 30, 'website/hero.jpg')]
    const { convex, calls } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['foreign'])
    const report = await runDemoCleanup({ convex, storage }, expire)
    expect(report).toMatchObject({ retryNeeded: true, storage: { outsidePrefix: 1, deleted: 0 } })
    expect(deleted).toEqual([])
    // The reference stays hidden and pending with a reason, never silently completed.
    expect(rows).toEqual([expect.objectContaining({ assetId: 'foreign', attempts: 1 })])
    expect(calls).toContain('fail:foreign:Outside the demo Storage prefix')
  })

  test('checks the current location, so an asset moved away since upload is kept', async () => {
    const rows = [row('moved', 30)]
    const { convex } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['moved'], {
      moved: new Map([['moved', 'website/keep.jpg']]),
    })
    const report = await runDemoCleanup({ convex, storage }, expire)
    expect(report).toMatchObject({ retryNeeded: true, storage: { outsidePrefix: 1, deleted: 0 } })
    expect(deleted).toEqual([])
    expect(rows).toEqual([expect.objectContaining({ assetId: 'moved', hidden: true })])
  })

  test('an interrupted deletion stays hidden and completes on the next run', async () => {
    const rows = [row('flaky', 30), row('fine', 30)]
    const { convex, calls } = fakeConvex(rows)
    const failing = new Set(['flaky'])
    const { storage, deleted } = fakeStorage(['flaky', 'fine'], { failing })
    const first = await runDemoCleanup({ convex, storage }, expire)
    expect(first).toMatchObject({ retryNeeded: true, storage: { failed: 1, deleted: 1 } })
    expect(rows).toEqual([expect.objectContaining({ assetId: 'flaky', hidden: true, attempts: 1 })])

    failing.clear()
    const second = await runDemoCleanup({ convex, storage }, expire)
    expect(second).toMatchObject({ retryNeeded: false, storage: { hidden: 0, deleted: 1 } })
    expect(deleted.sort()).toEqual(['fine', 'flaky'])
    expect(rows).toEqual([])
    expect(calls.some((call) => call.startsWith('fail:flaky'))).toBe(true)
  })

  test('failures on the first ledger page never block later pages', async () => {
    const assets = Array.from({ length: 150 }, (_, index) => `asset-${index}`)
    const rows = assets.map((assetId) => row(assetId, 30))
    const { convex } = fakeConvex(rows)
    const failing = new Set(assets.slice(0, 100))
    const { storage, deleted } = fakeStorage(assets, { failing })
    const report = await runDemoCleanup({ convex, storage }, { ...expire, batchSize: 100 })
    expect(report).toMatchObject({ retryNeeded: true, storage: { failed: 100, deleted: 50 } })
    expect(deleted).toEqual(assets.slice(100))
  })

  test("hiding continues from each call's cursor until the album is scanned", async () => {
    const rows = [row('fresh', 1), row('old-a', 30), row('old-b', 30)]
    const { convex, calls } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['fresh', 'old-a', 'old-b'])
    const report = await runDemoCleanup(
      { convex, storage },
      { dryRun: false, olderThanMs: 24 * hour, now, batchSize: 1 },
    )
    expect(report).toMatchObject({ storage: { hidden: 2, deleted: 2 } })
    expect(calls.filter((call) => call.startsWith('hide'))).toEqual(['hide', 'hide:1', 'hide:2'])
    expect(deleted).toEqual(['old-a', 'old-b'])
  })

  test('assets already gone from Storage still record their deletion', async () => {
    const rows = [row('gone', 30)]
    const { convex } = fakeConvex(rows)
    const { storage } = fakeStorage([])
    const report = await runDemoCleanup({ convex, storage }, expire)
    expect(report).toMatchObject({ storage: { alreadyDeleted: 1, failed: 0 } })
    expect(rows).toEqual([])
  })

  test('without Storage configuration nothing is hidden, so receipts cannot get stranded', async () => {
    const rows = [row('old', 30)]
    const { convex, calls } = fakeConvex(rows)
    const report = await runDemoCleanup({ convex }, expire)
    expect(report).toMatchObject({ storage: 'disabled', retryNeeded: false })
    expect(calls).toEqual([])
    expect(rows).toEqual([expect.objectContaining({ hidden: false })])
  })

  test('a reset records orphans in the ledger, then clears Storage and R2 before results', async () => {
    const rows = [row('registered', 1)]
    const { convex, calls } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['registered', 'orphan'])
    const r2Deleted: string[] = []
    const r2: CleanupR2 = {
      list: async () => ['wedding/wedding-gallery/a.jpg'],
      delete: async (keys) => {
        calls.push('r2')
        r2Deleted.push(...keys)
      },
    }
    const report = await runDemoCleanup({ convex, storage, r2 }, { dryRun: false, now })
    expect(report).toMatchObject({
      mode: 'reset',
      storage: { hidden: 1, deleted: 2, orphans: 1 },
      r2: { deleted: 1 },
      convex: { deletedResults: 3 },
    })
    expect(deleted.sort()).toEqual(['orphan', 'registered'])
    // The orphan is adopted before any byte is deleted, so a late notification cannot restore it.
    expect(calls.indexOf('adopt:registered,orphan')).toBeLessThan(calls.indexOf('complete:orphan'))
    expect(rows).toEqual([])
    expect(calls.indexOf('r2')).toBeLessThan(calls.indexOf('purge'))
  })

  test('a reset keeps Convex results while Storage deletions still need a retry', async () => {
    const { convex, calls } = fakeConvex([row('flaky', 1)])
    const { storage } = fakeStorage(['flaky'], { failing: new Set(['flaky']) })
    const report = await runDemoCleanup({ convex, storage }, { dryRun: false, now })
    expect(report).toMatchObject({ retryNeeded: true, storage: { failed: 1 } })
    expect(calls).not.toContain('purge')
  })
})
