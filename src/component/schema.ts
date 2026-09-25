import { defineSchema, defineTable } from 'convex/server'
import { vAssemblyFields, vAssemblyResultFields, vStoredAssetFields } from '../shared/schemas.ts'

export default defineSchema({
  assemblies: defineTable(vAssemblyFields)
    .index('by_assemblyId', ['assemblyId'])
    .index('by_status', ['status'])
    .index('by_userId', ['userId']),
  results: defineTable(vAssemblyResultFields)
    .index('by_assemblyId', ['assemblyId'])
    .index('by_assemblyId_and_step', ['assemblyId', 'stepName'])
    .index('by_album', ['album']),
  storedAssets: defineTable(vStoredAssetFields)
    .index('by_version', ['asset.workspace', 'asset.asset_id', 'asset.version_id'])
    .index('by_assemblyId', ['assemblyId'])
    .index('by_album_visibility', ['album', 'deletionRequestedAt', 'createdAt'])
    .index('by_album_pending_deletion', ['album', 'deletedAt', 'deletionRequestedAt']),
})
