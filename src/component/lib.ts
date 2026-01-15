import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server.js";
import {
  buildTransloaditParams,
  flattenResults,
  signTransloaditParams,
  verifyWebhookSignature,
} from "./apiUtils.js";

const TRANSLOADIT_ASSEMBLY_URL = "https://api2.transloadit.com/assemblies";

export const vAssembly = v.object({
  _id: v.id("assemblies"),
  _creationTime: v.number(),
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
});

export type Assembly = Infer<typeof vAssembly>;

export const vAssemblyResult = v.object({
  _id: v.id("results"),
  _creationTime: v.number(),
  assemblyId: v.string(),
  stepName: v.string(),
  resultId: v.optional(v.string()),
  sslUrl: v.optional(v.string()),
  name: v.optional(v.string()),
  size: v.optional(v.number()),
  mime: v.optional(v.string()),
  raw: v.any(),
  createdAt: v.number(),
});

export type AssemblyResult = Infer<typeof vAssemblyResult>;

export const vTransloaditConfig = v.object({
  authKey: v.string(),
  authSecret: v.string(),
});

const vAssemblyBaseArgs = {
  templateId: v.optional(v.string()),
  steps: v.optional(v.any()),
  fields: v.optional(v.any()),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  expires: v.optional(v.string()),
  additionalParams: v.optional(v.any()),
  userId: v.optional(v.string()),
};

export const upsertAssembly = internalMutation({
  args: {
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
    userId: v.optional(v.string()),
  },
  returns: v.id("assemblies"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("assemblies")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .unique();

    const now = Date.now();
    if (!existing) {
      return await ctx.db.insert("assemblies", {
        assemblyId: args.assemblyId,
        status: args.status,
        ok: args.ok,
        message: args.message,
        templateId: args.templateId,
        notifyUrl: args.notifyUrl,
        numExpectedUploadFiles: args.numExpectedUploadFiles,
        fields: args.fields,
        uploads: args.uploads,
        results: args.results,
        error: args.error,
        raw: args.raw,
        userId: args.userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(existing._id, {
      status: args.status ?? existing.status,
      ok: args.ok ?? existing.ok,
      message: args.message ?? existing.message,
      templateId: args.templateId ?? existing.templateId,
      notifyUrl: args.notifyUrl ?? existing.notifyUrl,
      numExpectedUploadFiles:
        args.numExpectedUploadFiles ?? existing.numExpectedUploadFiles,
      fields: args.fields ?? existing.fields,
      uploads: args.uploads ?? existing.uploads,
      results: args.results ?? existing.results,
      error: args.error ?? existing.error,
      raw: args.raw ?? existing.raw,
      userId: args.userId ?? existing.userId,
      updatedAt: now,
    });

    return existing._id;
  },
});

export const replaceResultsForAssembly = internalMutation({
  args: {
    assemblyId: v.string(),
    results: v.array(
      v.object({
        stepName: v.string(),
        result: v.any(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingResults = await ctx.db
      .query("results")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .collect();

    for (const existing of existingResults) {
      await ctx.db.delete(existing._id);
    }

    const now = Date.now();
    for (const entry of args.results) {
      const raw = entry.result as Record<string, unknown>;
      await ctx.db.insert("results", {
        assemblyId: args.assemblyId,
        stepName: entry.stepName,
        resultId: typeof raw.id === "string" ? raw.id : undefined,
        sslUrl: typeof raw.ssl_url === "string" ? raw.ssl_url : undefined,
        name: typeof raw.name === "string" ? raw.name : undefined,
        size: typeof raw.size === "number" ? raw.size : undefined,
        mime: typeof raw.mime === "string" ? raw.mime : undefined,
        raw,
        createdAt: now,
      });
    }

    return null;
  },
});

export const createAssembly = action({
  args: {
    config: vTransloaditConfig,
    ...vAssemblyBaseArgs,
  },
  returns: v.object({
    assemblyId: v.string(),
    data: v.any(),
  }),
  handler: async (ctx, args) => {
    const { paramsString, params } = buildTransloaditParams({
      authKey: args.config.authKey,
      templateId: args.templateId,
      steps: args.steps as Record<string, unknown> | undefined,
      fields: args.fields as Record<string, unknown> | undefined,
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles,
      expires: args.expires,
      additionalParams: args.additionalParams as
        | Record<string, unknown>
        | undefined,
    });

    const signature = await signTransloaditParams(
      paramsString,
      args.config.authSecret,
    );

    const formData = new FormData();
    formData.append("params", paramsString);
    formData.append("signature", signature);

    const response = await fetch(TRANSLOADIT_ASSEMBLY_URL, {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `Transloadit error ${response.status}: ${JSON.stringify(data)}`,
      );
    }

    const assemblyId =
      typeof data.assembly_id === "string"
        ? data.assembly_id
        : typeof data.assemblyId === "string"
          ? data.assemblyId
          : "";

    if (!assemblyId) {
      throw new Error("Transloadit response missing assembly_id");
    }

    await ctx.runMutation(internal.lib.upsertAssembly, {
      assemblyId,
      status: typeof data.ok === "string" ? data.ok : undefined,
      ok: typeof data.ok === "string" ? data.ok : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
      templateId: args.templateId,
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles,
      fields: params.fields,
      uploads: data.uploads,
      results: data.results,
      error: data.error,
      raw: data,
      userId: args.userId,
    });

    return { assemblyId, data };
  },
});

export const generateUploadParams = action({
  args: {
    config: vTransloaditConfig,
    ...vAssemblyBaseArgs,
  },
  returns: v.object({
    params: v.string(),
    signature: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    const { paramsString } = buildTransloaditParams({
      authKey: args.config.authKey,
      templateId: args.templateId,
      steps: args.steps as Record<string, unknown> | undefined,
      fields: args.fields as Record<string, unknown> | undefined,
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles,
      expires: args.expires,
      additionalParams: args.additionalParams as
        | Record<string, unknown>
        | undefined,
    });

    const signature = await signTransloaditParams(
      paramsString,
      args.config.authSecret,
    );

    return {
      params: paramsString,
      signature,
      url: TRANSLOADIT_ASSEMBLY_URL,
    };
  },
});

export const handleWebhook = action({
  args: {
    payload: v.any(),
    rawBody: v.optional(v.string()),
    signature: v.optional(v.string()),
    verifySignature: v.optional(v.boolean()),
    config: v.optional(
      v.object({
        authSecret: v.string(),
      }),
    ),
  },
  returns: v.object({
    assemblyId: v.string(),
    resultCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const rawBody = args.rawBody ?? JSON.stringify(args.payload ?? {});
    const shouldVerify = args.verifySignature ?? true;
    const authSecret =
      args.config?.authSecret ??
      process.env.TRANSLOADIT_AUTH_SECRET ??
      process.env.TRANSLOADIT_SECRET;

    if (shouldVerify) {
      if (!authSecret) {
        throw new Error(
          "Missing TRANSLOADIT_AUTH_SECRET for webhook validation",
        );
      }
      const verified = await verifyWebhookSignature({
        rawBody,
        signatureHeader: args.signature,
        authSecret,
      });
      if (!verified) {
        throw new Error("Invalid Transloadit webhook signature");
      }
    }

    const payload = args.payload as Record<string, unknown>;
    const assemblyId =
      typeof payload.assembly_id === "string"
        ? payload.assembly_id
        : typeof payload.assemblyId === "string"
          ? payload.assemblyId
          : "";

    if (!assemblyId) {
      throw new Error("Webhook payload missing assembly_id");
    }

    const results = flattenResults(
      (payload.results as Record<string, Array<Record<string, unknown>>>) ??
        undefined,
    );

    await ctx.runMutation(internal.lib.upsertAssembly, {
      assemblyId,
      status: typeof payload.ok === "string" ? payload.ok : undefined,
      ok: typeof payload.ok === "string" ? payload.ok : undefined,
      message:
        typeof payload.message === "string" ? payload.message : undefined,
      uploads: payload.uploads,
      results: payload.results,
      error: payload.error,
      raw: payload,
    });

    await ctx.runMutation(internal.lib.replaceResultsForAssembly, {
      assemblyId,
      results,
    });

    return { assemblyId, resultCount: results.length };
  },
});

export const getAssemblyStatus = query({
  args: { assemblyId: v.string() },
  returns: v.union(vAssembly, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("assemblies")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .unique();
  },
});

export const listAssemblies = query({
  args: {
    status: v.optional(v.string()),
    userId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(vAssembly),
  handler: async (ctx, args) => {
    if (args.userId) {
      return ctx.db
        .query("assemblies")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(args.limit ?? 50);
    }
    if (args.status) {
      return ctx.db
        .query("assemblies")
        .withIndex("by_status", (q) => q.eq("status", args.status))
        .order("desc")
        .take(args.limit ?? 50);
    }

    return ctx.db
      .query("assemblies")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const listResults = query({
  args: {
    assemblyId: v.string(),
    stepName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(vAssemblyResult),
  handler: async (ctx, args) => {
    if (args.stepName) {
      const stepName = args.stepName;
      return ctx.db
        .query("results")
        .withIndex("by_assemblyId_and_step", (q) =>
          q.eq("assemblyId", args.assemblyId).eq("stepName", stepName),
        )
        .order("desc")
        .take(args.limit ?? 200);
    }

    return ctx.db
      .query("results")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .order("desc")
      .take(args.limit ?? 200);
  },
});

export const storeAssemblyMetadata = mutation({
  args: {
    assemblyId: v.string(),
    userId: v.optional(v.string()),
    fields: v.optional(v.any()),
  },
  returns: v.union(vAssembly, v.null()),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("assemblies")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.patch(existing._id, {
      userId: args.userId ?? existing.userId,
      fields: args.fields ?? existing.fields,
      updatedAt: Date.now(),
    });

    return {
      ...existing,
      userId: args.userId ?? existing.userId,
      fields: args.fields ?? existing.fields,
    };
  },
});
