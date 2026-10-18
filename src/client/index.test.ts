import { createHmac } from 'node:crypto'
import { anyApi, componentsGeneric } from 'convex/server'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import componentSchema from '../component/schema.ts'
import { modules } from '../test/index.ts'
import { makeTransloaditAPI, Transloadit, type TransloaditComponent } from './index.ts'
import type { RunActionCtx, RunQueryCtx } from './types.ts'

beforeEach(() => vi.stubEnv('TRANSLOADIT_WORKSPACE', undefined))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// Convex's component proxy has an open shape; use the generated API at this test boundary.
const component = componentsGeneric().transloadit as unknown as TransloaditComponent

describe('operation-scoped credentials', () => {
  test('constructs and reads exact media without API credentials', async () => {
    vi.stubEnv('TRANSLOADIT_KEY', undefined)
    vi.stubEnv('TRANSLOADIT_SECRET', undefined)
    const client = new Transloadit(component, { storageWorkspace: 'test-workspace' })
    const runQuery = vi.fn<RunQueryCtx['runQuery']>().mockResolvedValue(null)
    expect(
      await client.getStoredMedia(
        { runQuery },
        {
          album: 'album',
          assetId: 'asset',
          versionId: 'version',
          originalSteps: [':original'],
          renditions: {},
        },
      ),
    ).toBeNull()
    expect(runQuery).toHaveBeenCalledOnce()
    expect(() => client.api()).not.toThrow()
  })

  test('fails signing before any component call when credentials are missing', async () => {
    vi.stubEnv('TRANSLOADIT_KEY', undefined)
    vi.stubEnv('TRANSLOADIT_SECRET', undefined)
    const client = new Transloadit(component)
    const runAction = vi.fn<RunActionCtx['runAction']>()
    const ctx = {
      runAction,
      runQuery: vi.fn<RunQueryCtx['runQuery']>(),
      runMutation: vi.fn<RunActionCtx['runMutation']>(),
    }
    await expect(client.createAssemblyOptions(ctx, {})).rejects.toThrow(
      'Missing TRANSLOADIT_KEY environment variable',
    )
    vi.stubEnv('TRANSLOADIT_KEY', 'test-key')
    await expect(client.createAssemblyOptions(ctx, {})).rejects.toThrow(
      'Missing TRANSLOADIT_SECRET environment variable',
    )
    await expect(client.createAssembly(ctx, {})).rejects.toThrow(
      'Missing TRANSLOADIT_SECRET environment variable',
    )
    await expect(client.refreshAssembly(ctx, 'assembly')).rejects.toThrow(
      'Missing TRANSLOADIT_SECRET environment variable',
    )
    expect(runAction).not.toHaveBeenCalled()
  })

  test('webhook verification needs the secret, not an Assembly API key', async () => {
    vi.stubEnv('TRANSLOADIT_KEY', undefined)
    vi.stubEnv('TRANSLOADIT_SECRET', undefined)
    const client = new Transloadit(component)
    vi.stubEnv('TRANSLOADIT_SECRET', 'test-webhook-secret')
    const runAction = vi.fn<RunActionCtx['runAction']>().mockResolvedValue({ queued: true })
    const ctx = {
      runAction,
      runQuery: vi.fn<RunQueryCtx['runQuery']>(),
      runMutation: vi.fn<RunActionCtx['runMutation']>(),
    }
    await client.queueWebhook(ctx, { payload: {}, signature: 'test-signature' })
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      payload: {},
      signature: 'test-signature',
      config: { authSecret: 'test-webhook-secret' },
      storage: undefined,
    })
  })

  test('retains explicit configuration and mutable public credential fields', async () => {
    vi.stubEnv('TRANSLOADIT_KEY', 'environment-key')
    vi.stubEnv('TRANSLOADIT_SECRET', 'environment-secret')
    const client = new Transloadit(component, {
      authKey: 'explicit-key',
      authSecret: 'explicit-secret',
    })
    const runAction = vi.fn<RunActionCtx['runAction']>().mockResolvedValue({})
    const ctx = {
      runAction,
      runQuery: vi.fn<RunQueryCtx['runQuery']>(),
      runMutation: vi.fn<RunActionCtx['runMutation']>(),
    }
    await client.createAssemblyOptions(ctx, {})
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      config: { authKey: 'explicit-key', authSecret: 'explicit-secret' },
    })
    client.config.authSecret = 'updated-secret'
    await client.createAssemblyOptions(ctx, {})
    expect(runAction.mock.calls[1]?.[1]).toEqual({
      config: { authKey: 'explicit-key', authSecret: 'updated-secret' },
    })
  })
})

// Registered functions carry their validators as JSON for deploys; the public type omits it.
const exportedArgs = (fn: unknown) =>
  JSON.parse((fn as { exportArgs(): string }).exportArgs()) as { value: Record<string, unknown> }

describe('makeTransloaditAPI', () => {
  const setup = () => {
    const t = convexTest({
      modules: {
        './transloadit.ts': async () => makeTransloaditAPI(component),
        './_generated/server.ts': () => import('convex/server'),
      },
    })
    t.registerComponent('transloadit', componentSchema, modules)
    return t
  }

  test.each(['handleWebhook', 'queueWebhook'])('%s verifies with only a secret', async (method) => {
    vi.stubEnv('TRANSLOADIT_KEY', undefined)
    vi.stubEnv('TRANSLOADIT_SECRET', 'test-secret')
    vi.useFakeTimers()
    const t = setup()
    const rawBody = JSON.stringify({ assembly_id: 'signed', ok: 'ASSEMBLY_COMPLETED' })
    const args = {
      rawBody,
      signature: `sha384:${createHmac('sha384', 'test-secret').update(rawBody).digest('hex')}`,
      payload: { assembly_id: 'tampered', ok: 'ASSEMBLY_COMPLETED' },
    }
    await t.action(anyApi.transloadit[method], args)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(
      await t.query(anyApi.transloadit.getAssemblyStatus, { assemblyId: 'signed' }),
    ).not.toBeNull()
    expect(
      await t.query(anyApi.transloadit.getAssemblyStatus, { assemblyId: 'tampered' }),
    ).toBeNull()
    await expect(
      t.action(anyApi.transloadit[method], { ...args, signature: 'invalid' }),
    ).rejects.toThrow()
    vi.stubEnv('TRANSLOADIT_SECRET', undefined)
    await expect(t.action(anyApi.transloadit[method], args)).rejects.toThrow(
      'Missing TRANSLOADIT_SECRET environment variable',
    )
  })

  test('keeps reads credential-free and signing fail-closed', async () => {
    vi.stubEnv('TRANSLOADIT_KEY', undefined)
    vi.stubEnv('TRANSLOADIT_SECRET', undefined)
    const t = setup()
    expect(await t.query(anyApi.transloadit.listAssemblies, {})).toEqual([])
    await expect(t.action(anyApi.transloadit.createAssemblyOptions, {})).rejects.toThrow(
      'Missing TRANSLOADIT_KEY environment variable',
    )
    vi.stubEnv('TRANSLOADIT_KEY', 'test-key')
    await expect(t.action(anyApi.transloadit.createAssemblyOptions, {})).rejects.toThrow(
      'Missing TRANSLOADIT_SECRET environment variable',
    )
  })

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
