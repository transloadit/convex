import { makeTransloaditAPI } from "@transloadit/convex";
import { components } from "./_generated/api";

export const {
  createAssembly,
  handleWebhook,
  queueWebhook,
  refreshAssembly,
  getAssemblyStatus,
  listAssemblies,
  listAlbumResults,
  listResults,
  storeAssemblyMetadata,
} = makeTransloaditAPI(components.transloadit);
