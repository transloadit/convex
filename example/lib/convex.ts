import { ConvexHttpClient } from 'convex/browser'
import { convexTest } from 'convex-test'
import { api } from '../../src/component/_generated/api.ts'
import schema from '../../src/component/schema.ts'
import { modules } from '../../src/test/nodeModules.ts'
import { buildWeddingSteps } from './transloadit-steps'

type Mode = 'local' | 'cloud'

const authKey = process.env.TRANSLOADIT_KEY ?? ''
const authSecret = process.env.TRANSLOADIT_SECRET ?? ''
const remoteUrl = process.env.E2E_REMOTE_URL ?? process.env.CONVEX_URL ?? ''
const remoteAdminKey = process.env.E2E_REMOTE_ADMIN_KEY ?? process.env.CONVEX_ADMIN_KEY ?? ''

const resolveMode = (): Mode => {
  const explicit = process.env.E2E_MODE
  if (explicit === 'cloud') return 'cloud'
  if (explicit === 'local') return 'local'
  if (remoteUrl && remoteAdminKey) return 'cloud'
  return 'local'
}

const mode = resolveMode()
const testClient = mode === 'local' ? convexTest(schema, modules) : null
const remoteClient =
  mode === 'cloud' && remoteUrl && remoteAdminKey
    ? new ConvexHttpClient(remoteUrl, { logger: false })
    : null

if (remoteClient) {
  const adminClient = remoteClient as ConvexHttpClient & {
    setAdminAuth: (token: string) => void
    setDebug: (value: boolean) => void
  }
  // Convex's admin auth helpers are intentionally not in the public typings.
  adminClient.setAdminAuth(remoteAdminKey)
  adminClient.setDebug(false)
}

export const runAction = async (name: string, args: Record<string, unknown>) => {
  if (remoteClient) {
    const remoteName =
      name === 'createWeddingAssemblyOptions'
        ? 'wedding:createWeddingAssemblyOptions'
        : `transloadit:${name}`
    const remoteAction = remoteClient as ConvexHttpClient & {
      action: (actionName: string, args: Record<string, unknown>) => Promise<unknown>
    }
    // Convex's client types only accept generated function references.
    return remoteAction.action(remoteName, args)
  }

  if (mode === 'cloud') {
    throw new Error('Missing E2E_REMOTE_URL or E2E_REMOTE_ADMIN_KEY')
  }

  if (!testClient) {
    throw new Error('Missing Convex test harness')
  }

  const config = authKey && authSecret ? { authKey, authSecret } : null
  if (!config) {
    throw new Error('Missing TRANSLOADIT_KEY or TRANSLOADIT_SECRET')
  }

  if (name === 'createWeddingAssemblyOptions') {
    const notifyUrl = process.env.TRANSLOADIT_NOTIFY_URL
    if (!notifyUrl) {
      throw new Error('Missing TRANSLOADIT_NOTIFY_URL')
    }
    const fileCount = typeof args.fileCount === 'number' ? Math.max(1, args.fileCount) : 1
    const guestName = typeof args.guestName === 'string' ? args.guestName : 'Guest'
    const requiredCode = process.env.WEDDING_UPLOAD_CODE
    if (requiredCode) {
      const provided = typeof args.uploadCode === 'string' ? args.uploadCode.trim() : ''
      if (!provided || provided !== requiredCode) {
        throw new Error('Upload code required.')
      }
    }

    const assemblyOptions = await testClient.action(api.lib.createAssemblyOptions, {
      steps: buildWeddingSteps(),
      notifyUrl,
      numExpectedUploadFiles: fileCount,
      fields: {
        guestName,
        album: 'wedding-gallery',
        fileCount,
      },
      config,
    })
    const params = safeParseParams(assemblyOptions.params)
    return {
      assemblyOptions,
      params,
    }
  }

  if (name === 'createAssembly') {
    const assemblyArgs = args as Record<string, unknown>
    return testClient.action(api.lib.createAssembly, {
      ...assemblyArgs,
      config,
    })
  }
  if (name === 'handleWebhook') {
    const webhookArgs = args as {
      payload: unknown
      signature?: string
      rawBody?: string
    }
    return testClient.action(api.lib.handleWebhook, {
      ...webhookArgs,
      config: { authSecret: config.authSecret },
    })
  }
  if (name === 'queueWebhook') {
    // Local harness does not run scheduled jobs, so process immediately.
    const webhookArgs = args as {
      payload: unknown
      signature?: string
      rawBody?: string
    }
    return testClient.action(api.lib.handleWebhook, {
      ...webhookArgs,
      config: { authSecret: config.authSecret },
    })
  }
  if (name === 'refreshAssembly') {
    const refreshArgs = args as { assemblyId: string }
    return testClient.action(api.lib.refreshAssembly, {
      ...refreshArgs,
      config,
    })
  }

  throw new Error(`Unknown action ${name}`)
}

export const runQuery = async (name: string, args: Record<string, unknown>) => {
  if (remoteClient) {
    const remoteQuery = remoteClient as ConvexHttpClient & {
      query: (queryName: string, args: Record<string, unknown>) => Promise<unknown>
    }
    return remoteQuery.query(`transloadit:${name}`, args)
  }

  if (mode === 'cloud') {
    throw new Error('Missing E2E_REMOTE_URL or E2E_REMOTE_ADMIN_KEY')
  }

  if (!testClient) {
    throw new Error('Missing Convex test harness')
  }

  if (name === 'getAssemblyStatus') {
    return testClient.query(api.lib.getAssemblyStatus, {
      assemblyId: args.assemblyId as string,
    })
  }
  if (name === 'listResults') {
    const listArgs = args as {
      assemblyId: string
      limit?: number
      stepName?: string
    }
    return testClient.query(api.lib.listResults, listArgs)
  }

  throw new Error(`Unknown query ${name}`)
}

const safeParseParams = (value: string) => {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch (error) {
    console.warn('Failed to parse Transloadit params', error)
    return null
  }
}
