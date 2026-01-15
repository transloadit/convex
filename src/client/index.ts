import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { type Infer, v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import type { RunActionCtx, RunMutationCtx, RunQueryCtx } from "./types.js";

export interface TransloaditConfig {
  authKey: string;
  authSecret: string;
}

export type TransloaditComponent = ComponentApi;

function requireEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing ${names.join(" or ")} environment variable`);
}

export const vAssemblyResponse = v.object({
  _id: v.string(),
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

export type AssemblyResponse = Infer<typeof vAssemblyResponse>;

export const vAssemblyResultResponse = v.object({
  _id: v.string(),
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

export type AssemblyResultResponse = Infer<typeof vAssemblyResultResponse>;

export const vCreateAssemblyArgs = v.object({
  templateId: v.optional(v.string()),
  steps: v.optional(v.any()),
  fields: v.optional(v.any()),
  notifyUrl: v.optional(v.string()),
  numExpectedUploadFiles: v.optional(v.number()),
  expires: v.optional(v.string()),
  additionalParams: v.optional(v.any()),
  userId: v.optional(v.string()),
});

export class TransloaditClient {
  declare component: TransloaditComponent;
  declare config: TransloaditConfig;

  constructor(
    component: TransloaditComponent,
    config?: Partial<TransloaditConfig>,
  ) {
    this.component = component;
    this.config = {
      authKey:
        config?.authKey ??
        requireEnv(["TRANSLOADIT_AUTH_KEY", "TRANSLOADIT_KEY"]),
      authSecret:
        config?.authSecret ??
        requireEnv(["TRANSLOADIT_AUTH_SECRET", "TRANSLOADIT_SECRET"]),
    };
  }

  static create(component: TransloaditComponent, config: TransloaditConfig) {
    return new TransloaditClient(component, config);
  }

  async createAssembly(
    ctx: RunActionCtx,
    args: Infer<typeof vCreateAssemblyArgs>,
  ) {
    return ctx.runAction(this.component.lib.createAssembly, {
      ...args,
      config: this.config,
    });
  }

  async generateUploadParams(
    ctx: RunActionCtx,
    args: Infer<typeof vCreateAssemblyArgs>,
  ) {
    return ctx.runAction(this.component.lib.generateUploadParams, {
      ...args,
      config: this.config,
    });
  }

  async handleWebhook(
    ctx: RunActionCtx,
    args: {
      payload: unknown;
      rawBody?: string;
      signature?: string;
      verifySignature?: boolean;
    },
  ) {
    return ctx.runAction(this.component.lib.handleWebhook, {
      ...args,
      config: { authSecret: this.config.authSecret },
    });
  }

  async getAssemblyStatus(ctx: RunQueryCtx, assemblyId: string) {
    return ctx.runQuery(this.component.lib.getAssemblyStatus, { assemblyId });
  }

  async listAssemblies(
    ctx: RunQueryCtx,
    args?: { status?: string; userId?: string; limit?: number },
  ) {
    return ctx.runQuery(this.component.lib.listAssemblies, args ?? {});
  }

  async listResults(
    ctx: RunQueryCtx,
    args: { assemblyId: string; stepName?: string; limit?: number },
  ) {
    return ctx.runQuery(this.component.lib.listResults, args);
  }

  async storeAssemblyMetadata(
    ctx: RunMutationCtx,
    args: { assemblyId: string; userId?: string; fields?: unknown },
  ) {
    return ctx.runMutation(this.component.lib.storeAssemblyMetadata, args);
  }

  api() {
    return makeTransloaditAPI(this.component, this.config);
  }
}

export function makeTransloaditAPI(
  component: TransloaditComponent,
  config?: Partial<TransloaditConfig>,
) {
  const resolvedConfig: TransloaditConfig = {
    authKey:
      config?.authKey ??
      requireEnv(["TRANSLOADIT_AUTH_KEY", "TRANSLOADIT_KEY"]),
    authSecret:
      config?.authSecret ??
      requireEnv(["TRANSLOADIT_AUTH_SECRET", "TRANSLOADIT_SECRET"]),
  };

  return {
    createAssembly: actionGeneric({
      args: vCreateAssemblyArgs,
      returns: v.object({
        assemblyId: v.string(),
        data: v.any(),
      }),
      handler: async (ctx, args) => {
        return ctx.runAction(component.lib.createAssembly, {
          ...args,
          config: resolvedConfig,
        });
      },
    }),
    generateUploadParams: actionGeneric({
      args: vCreateAssemblyArgs,
      returns: v.object({
        params: v.string(),
        signature: v.string(),
        url: v.string(),
      }),
      handler: async (ctx, args) => {
        return ctx.runAction(component.lib.generateUploadParams, {
          ...args,
          config: resolvedConfig,
        });
      },
    }),
    handleWebhook: actionGeneric({
      args: {
        payload: v.any(),
        rawBody: v.optional(v.string()),
        signature: v.optional(v.string()),
        verifySignature: v.optional(v.boolean()),
      },
      returns: v.object({
        assemblyId: v.string(),
        resultCount: v.number(),
      }),
      handler: async (ctx, args) => {
        return ctx.runAction(component.lib.handleWebhook, {
          ...args,
          config: { authSecret: resolvedConfig.authSecret },
        });
      },
    }),
    getAssemblyStatus: queryGeneric({
      args: { assemblyId: v.string() },
      returns: v.union(vAssemblyResponse, v.null()),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.getAssemblyStatus, args);
      },
    }),
    listAssemblies: queryGeneric({
      args: {
        status: v.optional(v.string()),
        userId: v.optional(v.string()),
        limit: v.optional(v.number()),
      },
      returns: v.array(vAssemblyResponse),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.listAssemblies, args);
      },
    }),
    listResults: queryGeneric({
      args: {
        assemblyId: v.string(),
        stepName: v.optional(v.string()),
        limit: v.optional(v.number()),
      },
      returns: v.array(vAssemblyResultResponse),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.listResults, args);
      },
    }),
    storeAssemblyMetadata: mutationGeneric({
      args: {
        assemblyId: v.string(),
        userId: v.optional(v.string()),
        fields: v.optional(v.any()),
      },
      returns: v.union(vAssemblyResponse, v.null()),
      handler: async (ctx, args) => {
        return ctx.runMutation(component.lib.storeAssemblyMetadata, args);
      },
    }),
  };
}
