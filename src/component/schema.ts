import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const assemblyStatusValues = [
  "ASSEMBLY_UPLOADING",
  "ASSEMBLY_EXECUTING",
  "ASSEMBLY_COMPLETED",
  "ASSEMBLY_CANCELED",
  "ASSEMBLY_FAILED",
] as const;

export type AssemblyStatus = (typeof assemblyStatusValues)[number];

export default defineSchema({
  assemblies: defineTable({
    assemblyId: v.string(),
    status: v.optional(v.string()),
    ok: v.optional(v.string()),
    message: v.optional(v.string()),
    templateId: v.optional(v.string()),
    notifyUrl: v.optional(v.string()),
    numExpectedUploadFiles: v.optional(v.number()),
    fields: v.optional(v.any()),
    uploads: v.optional(v.any()),
    results: v.optional(v.any()),
    error: v.optional(v.any()),
    raw: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    userId: v.optional(v.string()),
  })
    .index("by_assemblyId", ["assemblyId"])
    .index("by_status", ["status"])
    .index("by_userId", ["userId"]),
  results: defineTable({
    assemblyId: v.string(),
    stepName: v.string(),
    resultId: v.optional(v.string()),
    sslUrl: v.optional(v.string()),
    name: v.optional(v.string()),
    size: v.optional(v.number()),
    mime: v.optional(v.string()),
    raw: v.any(),
    createdAt: v.number(),
  })
    .index("by_assemblyId", ["assemblyId"])
    .index("by_assemblyId_and_step", ["assemblyId", "stepName"]),
});
