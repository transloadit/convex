import { makeTransloaditAPI } from "@transloadit/convex";
import { components } from "./_generated/api";

export const {
  createAssembly,
  handleWebhook,
  getAssemblyStatus,
  listAssemblies,
  listResults,
  storeAssemblyMetadata,
} = makeTransloaditAPI(components.transloadit);
