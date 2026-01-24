import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  assemblies: defineTable({
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
