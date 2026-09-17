import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
  albumGuests: defineTable({
    userId: v.id('users'),
    name: v.string(),
    version: v.string(),
  }).index('by_user', ['userId']),
  uploadLimits: defineTable({
    userId: v.string(),
    windowStart: v.number(),
    count: v.number(),
    lastUploadAt: v.number(),
  }).index('by_user', ['userId']),
})
