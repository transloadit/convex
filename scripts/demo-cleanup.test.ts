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

// An in-memory stand-in for the component ledger, with the same hide/complete/fail rules.
const fakeConvex = (rows: Row[]) => {
  const calls: string[] = []
  const convex: CleanupConvex = {
    summary: async ({ createdBefore }) => ({
      visibleStoredAssets: rows.filter((row) => !row.hidden).length,
      expiredStoredAssets: rows.filter((row) => !row.hidden && row.createdAt < createdBefore)
        .length,
      results: 3,
    }),
    requestStorageDeletion: async ({ createdBefore, limit }) => {
      calls.push('hide')
      const expired = rows.filter((row) => !row.hidden && row.createdAt < createdBefore)
      for (const row of expired.slice(0, limit)) row.hidden = true
      return {
        requested: expired.slice(0, limit).map((row) => ({ workspace: 'w', assetId: row.assetId })),
        hasMore: expired.length > limit,
      }
    },
    pendingStorageDeletions: async ({ limit }) =>
      rows
        .filter((row) => row.hidden)
        .slice(0, limit)
        .map((row) => ({
          workspace: 'w',
          assetId: row.assetId,
          paths: [row.path],
          deletionAttempts: row.attempts,
        })),
    completeStorageDeletion: async ({ assetId }) => {
      calls.push(`complete:${assetId}`)
      rows.splice(
        rows.findIndex((row) => row.assetId === assetId),
        1,
      )
    },
    failStorageDeletion: async ({ assetId }) => {
      calls.push(`fail:${assetId}`)
      const row = rows.find((candidate) => candidate.assetId === assetId)
      if (row) row.attempts += 1
    },
    purgeAlbum: async () => {
      calls.push('purge')
      return { deletedResults: 3, deletedAssemblies: 1 }
    },
  }
  return { convex, calls }
}

const fakeStorage = (objects: string[], failing = new Set<string>()) => {
  const deleted: string[] = []
  const storage: CleanupStorage = {
    workspace: 'w',
    prefix,
    list: async () =>
      objects
        .filter((assetId) => !deleted.includes(assetId))
        .map((assetId) => ({ asset_id: assetId, path: `${prefix}${assetId}.jpg` })),
    delete: async (assetId) => {
      if (failing.has(assetId)) throw Object.assign(new Error('HTTP 503'), { code: 'HTTP_503' })
      if (!objects.includes(assetId) || deleted.includes(assetId))
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

  test('expiry hides old photos, deletes their bytes, then drops the references', async () => {
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
    })
    expect(deleted).toEqual(['old'])
    expect(rows.map((candidate) => candidate.assetId)).toEqual(['new'])
    expect(calls).toEqual(['hide', 'complete:old'])
  })

  test('never deletes bytes outside this deployment prefix, even when a row names them', async () => {
    const rows = [row('foreign', 30, 'website/hero.jpg')]
    const { convex } = fakeConvex(rows)
    const { storage, deleted } = fakeStorage(['foreign'])
    const report = await runDemoCleanup(
      { convex, storage },
      { dryRun: false, olderThanMs: hour, now },
    )
    expect(report).toMatchObject({ storage: { skippedOutsidePrefix: 1, deleted: 0 } })
    expect(deleted).toEqual([])
    expect(rows).toEqual([])
  })

  test('an interrupted deletion stays hidden and completes on the next run', async () => {
    const rows = [row('flaky', 30), row('fine', 30)]
    const { convex, calls } = fakeConvex(rows)
    const failing = new Set(['flaky'])
    const { storage, deleted } = fakeStorage(['flaky', 'fine'], failing)
    const first = await runDemoCleanup(
      { convex, storage },
      { dryRun: false, olderThanMs: hour, now },
    )
    expect(first).toMatchObject({ retryNeeded: true, storage: { failed: 1, deleted: 1 } })
    expect(rows).toEqual([expect.objectContaining({ assetId: 'flaky', hidden: true, attempts: 1 })])

    failing.clear()
    const second = await runDemoCleanup(
      { convex, storage },
      { dryRun: false, olderThanMs: hour, now },
    )
    expect(second).toMatchObject({ retryNeeded: false, storage: { hidden: 0, deleted: 1 } })
    expect(deleted.sort()).toEqual(['fine', 'flaky'])
    expect(rows).toEqual([])
    expect(calls).toContain('fail:flaky')
  })

  test('assets already gone from Storage still release their references', async () => {
    const rows = [row('gone', 30)]
    const { convex } = fakeConvex(rows)
    const { storage } = fakeStorage([])
    const report = await runDemoCleanup(
      { convex, storage },
      { dryRun: false, olderThanMs: hour, now },
    )
    expect(report).toMatchObject({ storage: { alreadyDeleted: 1, failed: 0 } })
    expect(rows).toEqual([])
  })

  test('a reset clears Storage orphans and R2 before purging Convex results', async () => {
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
      storage: { hidden: 1, deleted: 1, orphans: 1 },
      r2: { deleted: 1 },
      convex: { deletedResults: 3 },
    })
    expect(deleted.sort()).toEqual(['orphan', 'registered'])
    expect(calls.indexOf('r2')).toBeLessThan(calls.indexOf('purge'))
  })

  test('a reset keeps Convex results while Storage deletions still need a retry', async () => {
    const { convex, calls } = fakeConvex([row('flaky', 1)])
    const { storage } = fakeStorage(['flaky'], new Set(['flaky']))
    await expect(runDemoCleanup({ convex, storage }, { dryRun: false, now })).rejects.toThrow(
      'HTTP 503',
    )
    expect(calls).not.toContain('purge')
  })
})
