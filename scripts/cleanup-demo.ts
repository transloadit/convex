import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Transloadit } from '@transloadit/node'
import { ConvexHttpClient } from 'convex/browser'
import {
  type CleanupConvex,
  type CleanupR2,
  type CleanupStorage,
  runDemoCleanup,
} from './demo-cleanup.ts'
import { loadEnv } from './env.ts'

loadEnv()

// Usage:
//   node scripts/cleanup-demo.ts --dry-run            reset preview across Convex, Storage and R2
//   node scripts/cleanup-demo.ts                      reset the whole demo album
//   node scripts/cleanup-demo.ts --older-than=24      expire Storage photos older than 24 hours
const argMap = new Map<string, string | boolean>()
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') {
    argMap.set('dry-run', true)
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
const prefix = (argMap.get('prefix') as string | undefined) || `wedding/${album}/`
const dryRun = argMap.get('dry-run') === true
const olderThan = argMap.get('older-than')
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
  summary: (args) => client.query('storageCleanup:summary', args) as never,
  requestStorageDeletion: (args) =>
    client.mutation('storageCleanup:requestDeletion', args) as never,
  pendingStorageDeletions: (args) => client.query('storageCleanup:pending', args) as never,
  completeStorageDeletion: (args) => client.mutation('storageCleanup:complete', args),
  failStorageDeletion: (args) => client.mutation('storageCleanup:fail', args),
  purgeAlbum: () =>
    client.mutation('transloadit:purgeAlbum', { album, deleteAssemblies: true }) as never,
}

// Matches example/lib/storage.ts: each Convex deployment writes under its own demo prefix.
const deploymentSlug = new URL(convexUrl).hostname.split('.')[0] || 'local'
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
        prefix: `convex-demo/${deploymentSlug}/${album}/`,
        list: async (storagePrefix) => {
          const assets: { asset_id: string; path: string }[] = []
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
            assets.push(...page.assets)
            cursor = page.next_cursor ?? undefined
          } while (cursor)
          return assets
        },
        delete: async (assetId) => {
          await transloadit.deleteStoredAsset(assetId)
        },
      }
    : undefined

const r2Config = {
  bucket: process.env.R2_BUCKET,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  host:
    process.env.R2_HOST ||
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : ''),
}
const r2: CleanupR2 | undefined =
  r2Config.bucket && r2Config.accessKeyId && r2Config.secretAccessKey && r2Config.host
    ? (() => {
        const bucket = r2Config.bucket
        const s3 = new S3Client({
          region: 'auto',
          endpoint: r2Config.host.startsWith('http') ? r2Config.host : `https://${r2Config.host}`,
          credentials: {
            accessKeyId: r2Config.accessKeyId,
            secretAccessKey: r2Config.secretAccessKey,
          },
        })
        return {
          list: async () => {
            const keys: string[] = []
            let continuationToken: string | undefined
            do {
              const response = await s3.send(
                new ListObjectsV2Command({
                  Bucket: bucket,
                  Prefix: prefix,
                  ContinuationToken: continuationToken,
                }),
              )
              for (const entry of response.Contents ?? []) if (entry.Key) keys.push(entry.Key)
              continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
            } while (continuationToken)
            return keys
          },
          delete: async (keys) => {
            await s3.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: keys.map((Key) => ({ Key })) },
              }),
            )
          },
        }
      })()
    : undefined

runDemoCleanup(
  { convex, storage, r2 },
  {
    dryRun,
    ...(olderThanHours === undefined ? {} : { olderThanMs: olderThanHours * 60 * 60 * 1000 }),
  },
)
  .then((report) => {
    console.log(JSON.stringify({ album, r2Prefix: prefix, ...report }, null, 2))
    if (!report.dryRun && report.retryNeeded) process.exitCode = 1
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
