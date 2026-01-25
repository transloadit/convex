import type { AssemblyStatus } from "@transloadit/zod/v3/assemblyStatus";
import type { AssemblyInstructionsInput } from "@transloadit/zod/v3/template";
import { anyApi, type FunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";
import { parseAssemblyStatus } from "../shared/assemblyUrls.ts";
import { transloaditError } from "../shared/errors.ts";
import { getResultUrl } from "../shared/resultUtils.ts";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server.ts";
import {
  buildTransloaditParams,
  flattenResults,
  signTransloaditParams,
  verifyWebhookSignature,
} from "./apiUtils.ts";

const TRANSLOADIT_ASSEMBLY_URL = "https://api2.transloadit.com/assemblies";

type ProcessWebhookResult = {
  assemblyId: string;
  resultCount: number;
  ok?: string;
  status?: string;
};

type InternalApi = {
  lib: {
    upsertAssembly: FunctionReference<
      "mutation",
      "internal",
      Record<string, unknown>,
      unknown
    >;
    replaceResultsForAssembly: FunctionReference<
      "mutation",
      "internal",
      Record<string, unknown>,
      unknown
    >;
    processWebhook: FunctionReference<
      "action",
      "internal",
      Record<string, unknown>,
      ProcessWebhookResult
    >;
  };
};

const internal = anyApi as unknown as InternalApi;

const resolveAssemblyId = (payload: AssemblyStatus): string => {
  if (typeof payload.assembly_id === "string") return payload.assembly_id;
  if (typeof payload.assemblyId === "string") return payload.assemblyId;
  return "";
};

const getFieldString = (fields: unknown, key: string): string | undefined => {
  if (!fields || typeof fields !== "object") return undefined;
  const value = (fields as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

const parseAssemblyPayload = (payload: unknown): AssemblyStatus => {
  const parsed = parseAssemblyStatus(payload);
  if (!parsed) {
    throw transloaditError("payload", "Invalid Transloadit payload");
  }
  return parsed;
};

const resolveWebhookRawBody = (args: {
  payload: unknown;
  rawBody?: string;
  verifySignature?: boolean;
}) => {
  if (typeof args.rawBody === "string") return args.rawBody;
  if (args.verifySignature === false) {
    return JSON.stringify(args.payload ?? {});
  }
  return null;
};

const buildSignedAssemblyUrl = async (
  assemblyId: string,
  authKey: string,
  authSecret: string,
): Promise<string> => {
  const params = JSON.stringify({
    auth: {
      key: authKey,
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
  const signature = await signTransloaditParams(params, authSecret);
  const url = new URL(`${TRANSLOADIT_ASSEMBLY_URL}/${assemblyId}`);
  url.searchParams.set("signature", signature);
  url.searchParams.set("params", params);
  return url.toString();
};

const applyAssemblyStatus = async (
  ctx: Pick<import("./_generated/server.ts").FunctionCtx, "runMutation">,
  payload: AssemblyStatus,
) => {
  const assemblyId = resolveAssemblyId(payload);
  if (!assemblyId) {
    throw transloaditError("webhook", "Webhook payload missing assembly_id");
  }

  const results = flattenResults(payload.results ?? undefined);

  await ctx.runMutation(internal.lib.upsertAssembly, {
    assemblyId,
    status: typeof payload.ok === "string" ? payload.ok : undefined,
    ok: typeof payload.ok === "string" ? payload.ok : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    templateId:
      typeof payload.template_id === "string" ? payload.template_id : undefined,
    notifyUrl:
      typeof payload.notify_url === "string" ? payload.notify_url : undefined,
    fields: payload.fields,
    uploads: payload.uploads,
    results: payload.results,
    error: payload.error,
    raw: payload,
    userId:
      typeof payload.user_id === "string"
        ? payload.user_id
        : getFieldString(payload.fields, "userId"),
  });

  await ctx.runMutation(internal.lib.replaceResultsForAssembly, {
    assemblyId,
    results,
  });

  return {
    assemblyId,
    resultCount: results.length,
    ok: typeof payload.ok === "string" ? payload.ok : undefined,
    status: typeof payload.ok === "string" ? payload.ok : undefined,
  };
};

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
  fields: v.optional(v.record(v.string(), v.any())),
  uploads: v.optional(v.array(v.any())),
  results: v.optional(v.record(v.string(), v.array(v.any()))),
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
  album: v.optional(v.string()),
  userId: v.optional(v.string()),
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
  steps: v.optional(v.record(v.string(), v.any())),
  fields: v.optional(v.record(v.string(), v.any())),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  expires: v.optional(v.string()),
  additionalParams: v.optional(v.record(v.string(), v.any())),
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
    fields: v.optional(v.record(v.string(), v.any())),
    uploads: v.optional(v.array(v.any())),
    results: v.optional(v.record(v.string(), v.array(v.any()))),
    error: v.optional(v.any()),
    raw: v.optional(v.any()),
    userId: v.optional(v.string()),
  },
  returns: v.id("assemblies"),
  handler: async (ctx, args) => {
    // Note: we persist full `raw` + `results` for debugging/fidelity. Large
    // assemblies can hit Convex document size limits; trim or externalize
    // payloads if this becomes an issue for your workload.
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
    // We store raw result payloads for fidelity. For very large assemblies,
    // consider trimming or externalizing these fields to avoid size limits.
    // This mutation replaces all results in one transaction; extremely large
    // result sets may need batching or external storage to avoid Convex limits.
    const existingResults = await ctx.db
      .query("results")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .collect();

    for (const existing of existingResults) {
      await ctx.db.delete(existing._id);
    }

    const assembly = await ctx.db
      .query("assemblies")
      .withIndex("by_assemblyId", (q) => q.eq("assemblyId", args.assemblyId))
      .unique();
    const album = getFieldString(assembly?.fields, "album");
    const userId =
      typeof assembly?.userId === "string"
        ? assembly.userId
        : getFieldString(assembly?.fields, "userId");

    const now = Date.now();
    for (const entry of args.results) {
      const raw = entry.result as Record<string, unknown>;
      const sslUrl = getResultUrl(entry.result);
      await ctx.db.insert("results", {
        assemblyId: args.assemblyId,
        album,
        userId,
        stepName: entry.stepName,
        resultId: typeof raw.id === "string" ? raw.id : undefined,
        sslUrl,
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
      steps: args.steps as AssemblyInstructionsInput["steps"],
      fields: args.fields as AssemblyInstructionsInput["fields"],
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: undefined,
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
    if (typeof args.numExpectedUploadFiles === "number") {
      formData.append(
        "tus_num_expected_upload_files",
        String(args.numExpectedUploadFiles),
      );
    }

    const response = await fetch(TRANSLOADIT_ASSEMBLY_URL, {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw transloaditError(
        "createAssembly",
        `HTTP ${response.status}: ${JSON.stringify(data)}`,
      );
    }

    const assemblyId =
      typeof data.assembly_id === "string"
        ? data.assembly_id
        : typeof data.assemblyId === "string"
          ? data.assemblyId
          : "";

    if (!assemblyId) {
      throw transloaditError(
        "createAssembly",
        "Transloadit response missing assembly_id",
      );
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

const vWebhookArgs = {
  payload: v.any(),
  rawBody: v.optional(v.string()),
  signature: v.optional(v.string()),
  verifySignature: v.optional(v.boolean()),
  authSecret: v.optional(v.string()),
};

const vPublicWebhookArgs = {
  payload: v.any(),
  rawBody: v.optional(v.string()),
  signature: v.optional(v.string()),
  verifySignature: v.optional(v.boolean()),
};

export const processWebhook = internalAction({
  args: vWebhookArgs,
  returns: v.object({
    assemblyId: v.string(),
    resultCount: v.number(),
    ok: v.optional(v.string()),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const rawBody = resolveWebhookRawBody(args);
    const shouldVerify = args.verifySignature ?? true;
    const authSecret = args.authSecret ?? process.env.TRANSLOADIT_SECRET;

    if (shouldVerify) {
      if (!rawBody) {
        throw transloaditError(
          "webhook",
          "Missing rawBody for webhook verification",
        );
      }
      if (!authSecret) {
        throw transloaditError(
          "webhook",
          "Missing TRANSLOADIT_SECRET for webhook validation",
        );
      }
      const verified = await verifyWebhookSignature({
        rawBody,
        signatureHeader: args.signature,
        authSecret,
      });
      if (!verified) {
        throw transloaditError(
          "webhook",
          "Invalid Transloadit webhook signature",
        );
      }
    }

    const parsed = parseAssemblyPayload(args.payload);
    return applyAssemblyStatus(ctx, parsed);
  },
});

export const handleWebhook = action({
  args: {
    ...vPublicWebhookArgs,
    config: v.optional(
      v.object({
        authSecret: v.string(),
      }),
    ),
  },
  returns: v.object({
    assemblyId: v.string(),
    resultCount: v.number(),
    ok: v.optional(v.string()),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const verifySignature = args.verifySignature ?? true;
    return ctx.runAction(internal.lib.processWebhook, {
      payload: args.payload,
      rawBody: args.rawBody,
      signature: args.signature,
      verifySignature,
      authSecret: args.config?.authSecret,
    });
  },
});

export const queueWebhook = action({
  args: {
    ...vPublicWebhookArgs,
    config: v.optional(
      v.object({
        authSecret: v.string(),
      }),
    ),
  },
  returns: v.object({
    assemblyId: v.string(),
    queued: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const rawBody = resolveWebhookRawBody(args);
    const shouldVerify = args.verifySignature ?? true;
    const authSecret =
      args.config?.authSecret ?? process.env.TRANSLOADIT_SECRET;

    if (shouldVerify) {
      if (!rawBody) {
        throw transloaditError(
          "webhook",
          "Missing rawBody for webhook verification",
        );
      }
      if (!authSecret) {
        throw transloaditError(
          "webhook",
          "Missing TRANSLOADIT_SECRET for webhook validation",
        );
      }
      const verified = await verifyWebhookSignature({
        rawBody,
        signatureHeader: args.signature,
        authSecret,
      });
      if (!verified) {
        throw transloaditError(
          "webhook",
          "Invalid Transloadit webhook signature",
        );
      }
    }

    const parsed = parseAssemblyPayload(args.payload);
    const assemblyId = resolveAssemblyId(parsed);
    if (!assemblyId) {
      throw transloaditError("webhook", "Webhook payload missing assembly_id");
    }

    await ctx.scheduler.runAfter(0, internal.lib.processWebhook, {
      payload: parsed,
      rawBody: args.rawBody,
      signature: args.signature,
      verifySignature: true,
      authSecret: args.config?.authSecret,
    });

    return { assemblyId, queued: true };
  },
});

export const refreshAssembly = action({
  args: {
    assemblyId: v.string(),
    config: v.optional(
      v.object({
        authKey: v.string(),
        authSecret: v.string(),
      }),
    ),
  },
  returns: v.object({
    assemblyId: v.string(),
    resultCount: v.number(),
    ok: v.optional(v.string()),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { assemblyId } = args;
    const authKey = args.config?.authKey ?? process.env.TRANSLOADIT_KEY;
    const authSecret =
      args.config?.authSecret ?? process.env.TRANSLOADIT_SECRET;
    const url =
      authKey && authSecret
        ? await buildSignedAssemblyUrl(assemblyId, authKey, authSecret)
        : `${TRANSLOADIT_ASSEMBLY_URL}/${assemblyId}`;

    const response = await fetch(url);
    const payload = parseAssemblyPayload(await response.json());
    if (!response.ok) {
      throw transloaditError(
        "status",
        `HTTP ${response.status}: ${JSON.stringify(payload)}`,
      );
    }

    return applyAssemblyStatus(ctx, payload);
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

export const listAlbumResults = query({
  args: {
    album: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(vAssemblyResult),
  handler: async (ctx, args) => {
    return ctx.db
      .query("results")
      .withIndex("by_album", (q) => q.eq("album", args.album))
      .order("desc")
      .take(args.limit ?? 200);
  },
});

export const purgeAlbum = mutation({
  args: {
    album: v.string(),
    deleteAssemblies: v.optional(v.boolean()),
  },
  returns: v.object({
    deletedResults: v.number(),
    deletedAssemblies: v.number(),
  }),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("results")
      .withIndex("by_album", (q) => q.eq("album", args.album))
      .collect();
    const assemblyIds = new Set<string>();

    for (const result of results) {
      assemblyIds.add(result.assemblyId);
      await ctx.db.delete(result._id);
    }

    let deletedAssemblies = 0;
    if (args.deleteAssemblies ?? true) {
      for (const assemblyId of assemblyIds) {
        const assembly = await ctx.db
          .query("assemblies")
          .withIndex("by_assemblyId", (q) => q.eq("assemblyId", assemblyId))
          .unique();
        if (assembly) {
          await ctx.db.delete(assembly._id);
          deletedAssemblies += 1;
        }
      }
    }

    return { deletedResults: results.length, deletedAssemblies };
  },
});

export const storeAssemblyMetadata = mutation({
  args: {
    assemblyId: v.string(),
    userId: v.optional(v.string()),
    fields: v.optional(v.record(v.string(), v.any())),
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
