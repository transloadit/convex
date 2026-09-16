import { makeTransloaditAPI } from '@transloadit/convex'
import { v } from 'convex/values'
import { components } from './_generated/api'
import { internalMutation } from './_generated/server'

// Guests can sign only the fixed wedding pipeline through wedding.ts.
export const {
  queueWebhook,
  refreshAssembly,
  getAssemblyStatus,
  listAssemblies,
  listAlbumResults,
  listResults,
} = makeTransloaditAPI(components.transloadit)

// The cleanup script uses admin authentication; guests must never be able to purge an album.
export const purgeAlbum = internalMutation({
  args: { album: v.string(), deleteAssemblies: v.optional(v.boolean()) },
  handler: (ctx, args) => ctx.runMutation(components.transloadit.lib.purgeAlbum, args),
})
