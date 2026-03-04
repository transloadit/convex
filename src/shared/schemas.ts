import type { AssemblyInstructionsInput } from '@transloadit/zod/v3/template'
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
  config: v.optional(
    v.object({
      authKey: v.string(),
      authSecret: v.string(),
    }),
  ),
}

export const vHandleWebhookArgs = {
  ...vPublicWebhookArgs,
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
