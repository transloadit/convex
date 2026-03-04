import { defineSchema, defineTable } from 'convex/server'
import { vAssemblyFields, vAssemblyResultFields } from '../shared/schemas.ts'

export default defineSchema({
  assemblies: defineTable(vAssemblyFields)
    .index('by_assemblyId', ['assemblyId'])
    .index('by_status', ['status'])
    .index('by_userId', ['userId']),
  results: defineTable(vAssemblyResultFields)
    .index('by_assemblyId', ['assemblyId'])
    .index('by_assemblyId_and_step', ['assemblyId', 'stepName'])
    .index('by_album', ['album']),
})
