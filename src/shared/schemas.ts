import type { AssemblyInstructionsInput } from '@transloadit/zod/v3/template'
import { paginationOptsValidator } from 'convex/server'
import { type Infer, v } from 'convex/values'

export const vAssemblyFields = {
  assemblyId: v.string(),
  status: v.optional(v.string()),
  ok: v.optional(v.string()),
  message: v.optional(v.string()),
  templateId: v.optional(v.string()),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  fields: v.optional(v.record(v.string(), v.any())),
  uploads: v.optional(v.array(v.any())),
  results: v.optional(v.record(v.string(), v.array(v.any()))),
  error: v.optional(v.any()),
  raw: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
  userId: v.optional(v.string()),
}

export const vAssemblyResultFields = {
  assemblyId: v.string(),
  album: v.optional(v.string()),
  userId: v.optional(v.string()),
  stepName: v.string(),
  resultId: v.optional(v.string()),
  sslUrl: v.optional(v.string()),
  name: v.optional(v.string()),
  size: v.optional(v.number()),
  mime: v.optional(v.string()),
  raw: v.any(),
  createdAt: v.number(),
}

/** Canonical Storage receipt, unchanged from the Assembly result (snake_case, as the SDKs use). */
export const vStoredAsset = v.object({
  workspace: v.string(),
  asset_id: v.string(),
  version_id: v.string(),
  path: v.string(),
  size: v.number(),
  mime: v.union(v.string(), v.null()),
  md5hash: v.optional(v.string()),
  sha256: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbhash: v.optional(v.string()),
  has_alpha: v.optional(v.boolean()),
})

export const vStoredAssetFields = {
  asset: vStoredAsset,
  // Provenance of the verified Assembly result that produced this version.
  assemblyId: v.string(),
  stepName: v.string(),
  resultId: v.string(),
  originalId: v.optional(v.union(v.string(), v.array(v.union(v.string(), v.null())))),
  // Copied from the Assembly's signed fields. Not ownership proof on its own: bind these to the
  // application's server-created upload record before granting access.
  album: v.optional(v.string()),
  userId: v.optional(v.string()),
  uploadId: v.optional(v.string()),
  createdAt: v.number(),
  // Deletion ledger: a requested deletion hides the row immediately and keeps it until the
  // Storage deletion is confirmed, so failed deletions remain retryable.
  deletionRequestedAt: v.optional(v.number()),
  deletionAttempts: v.optional(v.number()),
  deletionError: v.optional(v.string()),
  // Tombstone: Storage confirmed the deletion. The identity stays so a late notification cannot
  // register the deleted asset again; its ThumbHash image data is removed.
  deletedAt: v.optional(v.number()),
}

export const vStoredAssetRow = v.object({
  _id: v.id('storedAssets'),
  _creationTime: v.number(),
  ...vStoredAssetFields,
})

export type StoredAssetRow = Infer<typeof vStoredAssetRow>

export const vStoredAssetResponse = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  ...vStoredAssetFields,
})

export type StoredAssetResponse = Infer<typeof vStoredAssetResponse>

// A bounded, newest-first window. Growing `limit` keeps a reactive gallery free of page gaps.
export const vStoredAssetList = v.object({ page: v.array(vStoredAssetRow), hasMore: v.boolean() })
export const vStoredAssetResponseList = v.object({
  page: v.array(vStoredAssetResponse),
  hasMore: v.boolean(),
})

export const maxStoredAssetListLimit = 500

/** Enables Storage receipt ingestion; results from any other Workspace fail verification. */
export const vStorageConfig = v.object({ workspace: v.string() })

export type StorageConfig = Infer<typeof vStorageConfig>

export const vListStoredAssetsArgs = {
  album: v.string(),
  limit: v.optional(v.number()),
}

export const vGetStoredAssetArgs = {
  workspace: v.string(),
  assetId: v.string(),
  versionId: v.string(),
}

export const vListStoredAssetsForAssemblyArgs = {
  assemblyId: v.string(),
  limit: v.optional(v.number()),
}

export const vRegisterStoredAssetsArgs = {
  album: v.optional(v.string()),
  userId: v.optional(v.string()),
  uploadId: v.optional(v.string()),
  assets: v.array(
    v.object({
      asset: vStoredAsset,
      assemblyId: v.string(),
      stepName: v.string(),
      resultId: v.string(),
      originalId: v.optional(v.union(v.string(), v.array(v.union(v.string(), v.null())))),
    }),
  ),
}

export const vRegisterStoredAssetsResponse = v.object({
  inserted: v.number(),
  existing: v.number(),
})

export const vRequestStoredAssetDeletionArgs = {
  album: v.string(),
  createdBefore: v.number(),
  limit: v.optional(v.number()),
}

export const vStoredAssetReference = v.object({ workspace: v.string(), assetId: v.string() })

export type StoredAssetReference = Infer<typeof vStoredAssetReference>

export const vRequestStoredAssetDeletionResponse = v.object({
  requested: v.array(vStoredAssetReference),
  hasMore: v.boolean(),
})

export const vListStoredAssetDeletionsArgs = {
  album: v.string(),
  paginationOpts: paginationOptsValidator,
}

export const vStoredAssetDeletion = v.object({
  workspace: v.string(),
  assetId: v.string(),
  paths: v.array(v.string()),
  rows: v.number(),
  deletionRequestedAt: v.number(),
  deletionAttempts: v.number(),
  deletionError: v.optional(v.string()),
})

export type StoredAssetDeletion = Infer<typeof vStoredAssetDeletion>

export const vStoredAssetDeletionPage = v.object({
  page: v.array(vStoredAssetDeletion),
  isDone: v.boolean(),
  continueCursor: v.string(),
})

export const vCompleteStoredAssetDeletionArgs = {
  workspace: v.string(),
  assetId: v.string(),
}

export const vFailStoredAssetDeletionArgs = {
  workspace: v.string(),
  assetId: v.string(),
  error: v.string(),
}

export const vAssembly = v.object({
  _id: v.id('assemblies'),
  _creationTime: v.number(),
  ...vAssemblyFields,
})

export type Assembly = Infer<typeof vAssembly>

export const vAssemblyResponse = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  ...vAssemblyFields,
})

export type AssemblyResponse = Infer<typeof vAssemblyResponse>

export const vAssemblyResult = v.object({
  _id: v.id('results'),
  _creationTime: v.number(),
  ...vAssemblyResultFields,
})

export type AssemblyResult = Infer<typeof vAssemblyResult>

export const vAssemblyResultResponse = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  ...vAssemblyResultFields,
})

export type AssemblyResultResponse = Infer<typeof vAssemblyResultResponse>

export const vTransloaditConfig = v.object({
  authKey: v.string(),
  authSecret: v.string(),
})

export type TransloaditConfig = Infer<typeof vTransloaditConfig>

export const vAssemblyBaseArgs = {
  templateId: v.optional(v.string()),
  steps: v.optional(v.record(v.string(), v.any())),
  fields: v.optional(v.record(v.string(), v.any())),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  expires: v.optional(v.string()),
  additionalParams: v.optional(v.record(v.string(), v.any())),
  userId: v.optional(v.string()),
}

export const vCreateAssemblyArgs = v.object(vAssemblyBaseArgs)

export type CreateAssemblyArgs = Omit<Infer<typeof vCreateAssemblyArgs>, 'steps' | 'fields'> & {
  steps?: AssemblyInstructionsInput['steps']
  fields?: AssemblyInstructionsInput['fields']
}

export const vCreateAssemblyReturn = v.object({
  assemblyId: v.string(),
  data: v.any(),
})

export type CreateAssemblyReturn = Infer<typeof vCreateAssemblyReturn>

export const vAssemblyOptions = v.object({
  params: v.string(),
  signature: v.string(),
  fields: v.optional(v.record(v.string(), v.any())),
})

export type AssemblyOptions = Infer<typeof vAssemblyOptions>

export const vWebhookArgs = {
  payload: v.any(),
  rawBody: v.optional(v.string()),
  signature: v.optional(v.string()),
  verifySignature: v.optional(v.boolean()),
  authSecret: v.optional(v.string()),
  storage: v.optional(vStorageConfig),
}

export const vPublicWebhookArgs = {
  payload: v.any(),
  rawBody: v.optional(v.string()),
  signature: v.optional(v.string()),
  verifySignature: v.optional(v.boolean()),
}

export const vWebhookActionArgs = v.object({
  payload: v.any(),
  rawBody: v.optional(v.string()),
  signature: v.optional(v.string()),
})

export type WebhookActionArgs = Infer<typeof vWebhookActionArgs>

export const vWebhookResponse = v.object({
  assemblyId: v.string(),
  resultCount: v.number(),
  storedAssetCount: v.optional(v.number()),
  ok: v.optional(v.string()),
  status: v.optional(v.string()),
})

export type WebhookResponse = Infer<typeof vWebhookResponse>

export const vQueueWebhookResponse = v.object({
  assemblyId: v.string(),
  queued: v.boolean(),
})

export type QueueWebhookResponse = Infer<typeof vQueueWebhookResponse>

export const vAssemblyIdArgs = {
  assemblyId: v.string(),
}

export const vListAssembliesArgs = {
  status: v.optional(v.string()),
  userId: v.optional(v.string()),
  limit: v.optional(v.number()),
}

export const vListResultsArgs = {
  assemblyId: v.string(),
  stepName: v.optional(v.string()),
  limit: v.optional(v.number()),
}

export const vListAlbumResultsArgs = {
  album: v.string(),
  limit: v.optional(v.number()),
}

export const vPurgeAlbumArgs = {
  album: v.string(),
  deleteAssemblies: v.optional(v.boolean()),
}

export const vPurgeAlbumResponse = v.object({
  deletedResults: v.number(),
  deletedAssemblies: v.number(),
})

export type PurgeAlbumResponse = Infer<typeof vPurgeAlbumResponse>

export const vStoreAssemblyMetadataArgs = {
  assemblyId: v.string(),
  userId: v.optional(v.string()),
  fields: v.optional(v.record(v.string(), v.any())),
}

export const vRefreshAssemblyArgs = {
  assemblyId: v.string(),
  expectedFields: v.optional(v.record(v.string(), v.string())),
  storage: v.optional(vStorageConfig),
  config: v.optional(
    v.object({
      authKey: v.string(),
      authSecret: v.string(),
    }),
  ),
}

export const vHandleWebhookArgs = {
  ...vPublicWebhookArgs,
  storage: v.optional(vStorageConfig),
  config: v.optional(
    v.object({
      authSecret: v.string(),
    }),
  ),
}

export const vProcessWebhookResult = vWebhookResponse

export type ProcessWebhookResult = Infer<typeof vProcessWebhookResult>

export const vReplaceResultsArgs = {
  assemblyId: v.string(),
  results: v.array(
    v.object({
      stepName: v.string(),
      result: v.any(),
    }),
  ),
}

export const vUpsertAssemblyArgs = {
  assemblyId: v.string(),
  status: v.optional(v.string()),
  ok: v.optional(v.string()),
  message: v.optional(v.string()),
  templateId: v.optional(v.string()),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  fields: v.optional(v.record(v.string(), v.any())),
  uploads: v.optional(v.array(v.any())),
  results: v.optional(v.record(v.string(), v.array(v.any()))),
  error: v.optional(v.any()),
  raw: v.optional(v.any()),
  userId: v.optional(v.string()),
}

export const vBuildParamsOptions = v.object({
  authKey: v.string(),
  templateId: v.optional(v.string()),
  steps: v.optional(v.any()),
  fields: v.optional(v.any()),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  expires: v.optional(v.string()),
  additionalParams: v.optional(v.record(v.string(), v.any())),
})

export type BuildParamsOptions = Omit<Infer<typeof vBuildParamsOptions>, 'steps' | 'fields'> & {
  steps?: AssemblyInstructionsInput['steps']
  fields?: AssemblyInstructionsInput['fields']
}

export const vBuildParamsResult = v.object({
  params: v.record(v.string(), v.any()),
  paramsString: v.string(),
})

export type BuildParamsResult = Infer<typeof vBuildParamsResult>

const vParsedWebhookFields = {
  payload: v.any(),
  rawBody: v.string(),
  signature: v.optional(v.string()),
}

export const vParsedWebhookRequest = v.object(vParsedWebhookFields)

export type ParsedWebhookRequest = Infer<typeof vParsedWebhookRequest>

export const vVerifiedWebhookRequest = v.object({
  ...vParsedWebhookFields,
  verified: v.boolean(),
})

export type VerifiedWebhookRequest = Infer<typeof vVerifiedWebhookRequest>
