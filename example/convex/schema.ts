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
  // Server-created upload records bind Storage receipts to a guest, album and destination prefix.
  uploads: defineTable({
    uploadId: v.string(),
    userId: v.string(),
    guestName: v.string(),
    album: v.string(),
    fileCount: v.number(),
    storagePrefix: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_uploadId', ['uploadId']),
  uploadLimits: defineTable({
    userId: v.string(),
    windowStart: v.number(),
    count: v.number(),
    lastUploadAt: v.number(),
  }).index('by_user', ['userId']),
})
