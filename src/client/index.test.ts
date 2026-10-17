import { componentsGeneric } from 'convex/server'
import { describe, expect, test, vi } from 'vitest'
import { makeTransloaditAPI, Transloadit, type TransloaditComponent } from './index.ts'
import type { RunQueryCtx } from './types.ts'

// Registered functions carry their validators as JSON for deploys; the public type omits it.
const exportedArgs = (fn: unknown) =>
  JSON.parse((fn as { exportArgs(): string }).exportArgs()) as { value: Record<string, unknown> }

describe('makeTransloaditAPI', () => {
  test('album listings do not let callers choose Assembly fields to join', () => {
    const api = makeTransloaditAPI({} as TransloaditComponent)
    expect(Object.keys(exportedArgs(api.listAlbumResults).value).sort()).toEqual([
      'album',
      'createdAfter',
      'limit',
      'stepNames',
    ])
  })
})

test('exact media lookup only forwards component fields, not caller app data', async () => {
  // Convex's AnyComponentReference omits named exports; bind this test proxy to generated ComponentApi.
  const component = componentsGeneric().transloadit as unknown as TransloaditComponent
  const client = new Transloadit(component, {
    authKey: 'test-key',
    authSecret: 'test-secret',
    storageWorkspace: 'test-workspace',
  })
  const runQuery = vi.fn<RunQueryCtx['runQuery']>().mockResolvedValue(null)
  const args = {
    album: 'album-1',
    assetId: 'asset-1',
    versionId: 'version-1',
    originalSteps: [':original'],
    renditions: { poster: 'poster' },
    shareToken: 'app-only-field',
  }
  expect(await client.getStoredMedia({ runQuery }, args)).toBeNull()
  expect(runQuery).toHaveBeenCalledOnce()
  expect(runQuery.mock.calls[0]?.[1]).toEqual({
    workspace: 'test-workspace',
    album: 'album-1',
    assetId: 'asset-1',
    versionId: 'version-1',
    originalSteps: [':original'],
    renditions: { poster: 'poster' },
  })
})
