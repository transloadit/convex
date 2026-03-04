import { makeTransloaditAPI } from '@transloadit/convex'
import { components } from './_generated/api'

export const {
  createAssembly,
  createAssemblyOptions,
  handleWebhook,
  queueWebhook,
  refreshAssembly,
  getAssemblyStatus,
  listAssemblies,
  listAlbumResults,
  listResults,
  purgeAlbum,
  storeAssemblyMetadata,
} = makeTransloaditAPI(components.transloadit)
