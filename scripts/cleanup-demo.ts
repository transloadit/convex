import { Transloadit } from '@transloadit/node'
import { ConvexHttpClient } from 'convex/browser'
import {
  type CleanupConvex,
  type CleanupStorage,
  runDemoCleanup,
  type StorageObject,
} from './demo-cleanup.ts'
import { loadEnv } from './env.ts'

loadEnv()

// Usage:
//   node scripts/cleanup-demo.ts --dry-run            reset preview across Convex and Storage
//   node scripts/cleanup-demo.ts                      reset the whole demo album
//   node scripts/cleanup-demo.ts --older-than=24      expire Storage photos older than 24 hours
// Missing Storage access must be skipped explicitly. This tool never operates on old public exports.
const argMap = new Map<string, string | boolean>()
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run' || arg === '--skip-storage') {
    argMap.set(arg.slice(2), true)
    continue
  }
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=')
    if (key) {
      argMap.set(key, value ?? '')
    }
  }
}

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} environment variable`)
  }
  return value
}

const album =
  (argMap.get('album') as string | undefined) || process.env.DEMO_ALBUM || 'wedding-gallery'
const dryRun = argMap.get('dry-run') === true
const olderThan = argMap.get('older-than')
const expectedStoragePrefix = argMap.get('expected-prefix')
if (expectedStoragePrefix !== undefined && typeof expectedStoragePrefix !== 'string') {
  throw new Error('--expected-prefix must be a Storage path')
}
const olderThanHours = olderThan === undefined ? undefined : Number(olderThan)
if (olderThanHours !== undefined && !(Number.isFinite(olderThanHours) && olderThanHours > 0)) {
  throw new Error('--older-than must be a positive number of hours')
}

const convexUrl = requireEnv('CONVEX_URL')
const convexAdminKey = requireEnv('CONVEX_ADMIN_KEY')

const client = new ConvexHttpClient(convexUrl, {
  logger: false,
}) as ConvexHttpClient & {
  setAdminAuth: (token: string) => void
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>
  query: (name: string, args: Record<string, unknown>) => Promise<unknown>
}
client.setAdminAuth(convexAdminKey)

const convex: CleanupConvex = {
  summary: () => client.query('storageCleanup:summary', { album }) as never,
  visiblePage: ({ cursor }) =>
    client.query('storageCleanup:visiblePage', { album, cursor }) as never,
  previewExpiry: (args) =>
    client.query('storageCleanup:previewExpiry', { album, ...args }) as never,
  requestStorageDeletion: (args) =>
    client.mutation('storageCleanup:requestDeletion', { album, ...args }) as never,
  pendingStorageDeletions: ({ cursor, numItems }) =>
    client.query('storageCleanup:pending', {
      album,
      paginationOpts: { cursor, numItems },
    }) as never,
  completeStorageDeletion: (args) => client.mutation('storageCleanup:complete', args),
  failStorageDeletion: (args) => client.mutation('storageCleanup:fail', args),
  adoptForDeletion: (assets) => client.mutation('storageCleanup:adopt', { album, assets }) as never,
  purgeAlbum: () =>
    client.mutation('transloadit:purgeAlbum', { album, deleteAssemblies: true }) as never,
}

const canonicalFields = new Set([
  'workspace',
  'asset_id',
  'version_id',
  'path',
  'size',
  'mime',
  'md5hash',
  'sha256',
  'width',
  'height',
  'thumbhash',
  'has_alpha',
])
const workspace = process.env.TRANSLOADIT_WORKSPACE?.trim()
const transloadit = workspace
  ? new Transloadit({
      authKey: requireEnv('TRANSLOADIT_KEY'),
      authSecret: requireEnv('TRANSLOADIT_SECRET'),
    })
  : undefined
const storage: CleanupStorage | undefined =
  workspace && transloadit
    ? {
        workspace,
        list: async (storagePrefix) => {
          const assets: StorageObject[] = []
          let cursor: string | undefined
          do {
            const page = await transloadit.listStoredAssets({
              prefix: storagePrefix,
              limit: 500,
              ...(cursor ? { cursor } : {}),
            })
            if (page.workspace !== workspace) {
              throw new Error('TRANSLOADIT_KEY belongs to a different Storage Workspace')
            }
            // Keep only canonical receipt fields; the ledger validates exactly this shape.
            for (const asset of page.assets) {
              assets.push(
                Object.fromEntries(
                  Object.entries(asset).filter(
                    ([key, value]) => canonicalFields.has(key) && value !== undefined,
                  ),
                ) as StorageObject,
              )
            }
            cursor = page.next_cursor ?? undefined
          } while (cursor)
          return assets
        },
        currentPath: async (assetId) => {
          try {
            return (await transloadit.getStoredAsset(assetId)).path
          } catch (error) {
            if ((error as { code?: unknown })?.code === 'DAM_RESOURCE_NOT_FOUND') return null
            throw error
          }
        },
        delete: async (assetId) => {
          await transloadit.deleteStoredAsset(assetId)
        },
      }
    : undefined

runDemoCleanup(
  { convex, storage },
  {
    dryRun,
    skipStorage: argMap.get('skip-storage') === true,
    ...(olderThanHours === undefined ? {} : { olderThanMs: olderThanHours * 60 * 60 * 1000 }),
    ...(expectedStoragePrefix === undefined ? {} : { expectedStoragePrefix }),
  },
)
  .then((report) => {
    console.log(JSON.stringify({ album, ...report }, null, 2))
    if (!report.dryRun && report.retryNeeded) process.exitCode = 1
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
