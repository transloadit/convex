import type { AssemblyStatus } from '@transloadit/zod/v3/assemblyStatus'
import type { AssemblyInstructionsInput } from '@transloadit/zod/v3/template'
import { actionGeneric, mutationGeneric, type PaginationOptions, queryGeneric } from 'convex/server'
import { type ObjectType, v } from 'convex/values'
import type { ComponentApi } from '../component/_generated/component.ts'
import {
  type AssemblyOptions,
  type AssemblyResponse,
  type AssemblyResultResponse,
  type CreateAssemblyArgs,
  type StorageConfig,
  type StoredAssetReference,
  type StoredAssetResponse,
  vAssemblyIdArgs,
  vAssemblyOptions,
  vAssemblyResponse,
  vAssemblyResultResponse,
  vCreateAssemblyArgs,
  vCreateAssemblyReturn,
  vListAlbumResultsArgs,
  vListAssembliesArgs,
  vListResultsArgs,
  vPurgeAlbumArgs,
  vPurgeAlbumResponse,
  vQueueWebhookResponse,
  vStoreAssemblyMetadataArgs,
  vWebhookActionArgs,
  vWebhookResponse,
} from '../shared/schemas.ts'
import type { RunActionCtx, RunMutationCtx, RunQueryCtx } from './types.ts'

export {
  assemblyStatusErrCodeSchema,
  assemblyStatusOkCodeSchema,
  assemblyStatusResultsSchema,
  assemblyStatusSchema,
  isAssemblyBusy,
  isAssemblyBusyStatus,
  isAssemblyErrorStatus,
  isAssemblyOkStatus,
  isAssemblySysError,
  isAssemblyTerminal,
  isAssemblyTerminalError,
  isAssemblyTerminalOk,
  isAssemblyTerminalOkStatus,
} from '@transloadit/zod/v3/assemblyStatus'
export {
  buildWebhookQueueArgs,
  handleWebhookRequest,
  parseAndVerifyTransloaditWebhook,
  parseTransloaditWebhook,
} from '../component/apiUtils.ts'
export type {
  NormalizedAssemblyUrls,
  TransloaditAssembly,
} from '../shared/assemblyUrls.ts'
export {
  ASSEMBLY_STATUS_COMPLETED,
  ASSEMBLY_STATUS_UPLOADING,
  getAssemblyStage,
  isAssemblyCompletedStatus,
  isAssemblyUploadingStatus,
  normalizeAssemblyUploadUrls,
  parseAssemblyFields,
  parseAssemblyResults,
  parseAssemblyStatus,
  parseAssemblyUrls,
} from '../shared/assemblyUrls.ts'
export { pollAssembly } from '../shared/pollAssembly.ts'
export type {
  ImageResizeResult,
  ResultByRobot,
  ResultForRobot,
  StoreResult,
  TransloaditResult,
  VideoEncodeResult,
  VideoThumbsResult,
} from '../shared/resultTypes.ts'
export {
  getResultOriginalKey,
  getResultUrl,
} from '../shared/resultUtils.ts'
export type {
  ParsedWebhookRequest,
  StorageConfig,
  StoredAssetDeletion,
  StoredAssetReference,
  StoredAssetResponse,
  VerifiedWebhookRequest,
  WebhookActionArgs,
} from '../shared/schemas.ts'
export {
  vStoredAsset,
  vStoredAssetResponse,
  vStoredAssetResponseList,
} from '../shared/schemas.ts'
export type { StoredAssemblyAsset, StoredAsset } from '../shared/storedAssets.ts'
export { selectStoredAssets } from '../shared/storedAssets.ts'
export type { AssemblyInstructionsInput, AssemblyStatus }
export { vAssemblyResponse, vAssemblyResultResponse, vCreateAssemblyArgs }

export interface TransloaditConfig {
  authKey: string
  authSecret: string
  /**
   * Transloadit Storage Workspace whose receipts completed Assemblies register. Receipts from any
   * other Workspace fail verification. Defaults to TRANSLOADIT_WORKSPACE; unset disables ingestion.
   */
  storageWorkspace?: string
}

export type TransloaditComponent = ComponentApi

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined
}

function requireEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value) {
      return value
    }
  }
  throw new Error(`Missing ${names.join(' or ')} environment variable`)
}

export type { AssemblyOptions, AssemblyResponse, AssemblyResultResponse, CreateAssemblyArgs }
export { vAssemblyOptions }

/**
 * @deprecated Prefer `makeTransloaditAPI` or `Transloadit` for new code.
 */
export class TransloaditClient {
  declare component: TransloaditComponent
  declare config: TransloaditConfig

  constructor(component: TransloaditComponent, config?: Partial<TransloaditConfig>) {
    this.component = component
    this.config = {
      authKey: config?.authKey ?? requireEnv(['TRANSLOADIT_KEY']),
      authSecret: config?.authSecret ?? requireEnv(['TRANSLOADIT_SECRET']),
      storageWorkspace: config?.storageWorkspace ?? optionalEnv('TRANSLOADIT_WORKSPACE'),
    }
  }

  private get storage(): StorageConfig | undefined {
    return this.config.storageWorkspace ? { workspace: this.config.storageWorkspace } : undefined
  }

  static create(component: TransloaditComponent, config: TransloaditConfig) {
    return new TransloaditClient(component, config)
  }

  async createAssembly(ctx: RunActionCtx, args: CreateAssemblyArgs) {
    return ctx.runAction(this.component.lib.createAssembly, {
      ...args,
      config: { authKey: this.config.authKey, authSecret: this.config.authSecret },
    })
  }

  async createAssemblyOptions(ctx: RunActionCtx, args: CreateAssemblyArgs) {
    return ctx.runAction(this.component.lib.createAssemblyOptions, {
      ...args,
      config: { authKey: this.config.authKey, authSecret: this.config.authSecret },
    })
  }

  async handleWebhook(
    ctx: RunActionCtx,
    args: {
      payload: unknown
      rawBody?: string
      signature?: string
      verifySignature?: boolean
    },
  ) {
    return ctx.runAction(this.component.lib.handleWebhook, {
      ...args,
      config: { authSecret: this.config.authSecret },
      storage: this.storage,
    })
  }

  async queueWebhook(
    ctx: RunActionCtx,
    args: {
      payload: unknown
      rawBody?: string
      signature?: string
      verifySignature?: boolean
    },
  ) {
    return ctx.runAction(this.component.lib.queueWebhook, {
      ...args,
      config: { authSecret: this.config.authSecret },
      storage: this.storage,
    })
  }

  async refreshAssembly(ctx: RunActionCtx, assemblyId: string) {
    return ctx.runAction(this.component.lib.refreshAssembly, {
      assemblyId,
      config: { authKey: this.config.authKey, authSecret: this.config.authSecret },
      storage: this.storage,
    })
  }

  async getAssemblyStatus(ctx: RunQueryCtx, assemblyId: string) {
    return ctx.runQuery(this.component.lib.getAssemblyStatus, { assemblyId })
  }

  async listAssemblies(
    ctx: RunQueryCtx,
    args?: { status?: string; userId?: string; limit?: number },
  ) {
    return ctx.runQuery(this.component.lib.listAssemblies, args ?? {})
  }

  async listResults(
    ctx: RunQueryCtx,
    args: { assemblyId: string; stepName?: string; limit?: number },
  ) {
    return ctx.runQuery(this.component.lib.listResults, args)
  }

  async listAlbumResults(ctx: RunQueryCtx, args: { album: string; limit?: number }) {
    return ctx.runQuery(this.component.lib.listAlbumResults, args)
  }

  /**
   * Visible Storage receipts of one album from local indexed data. Call it only from an app query
   * that has authorized the viewer; receipts are private metadata, not delivery credentials.
   */
  async listStoredAssets(ctx: RunQueryCtx, args: { album: string; limit?: number }) {
    return ctx.runQuery(this.component.lib.listStoredAssets, args)
  }

  /** One exact visible version, or null when it is unknown or awaiting deletion. */
  async getStoredAsset(
    ctx: RunQueryCtx,
    args: { assetId: string; versionId: string; workspace?: string },
  ): Promise<StoredAssetResponse | null> {
    const workspace = args.workspace ?? this.config.storageWorkspace
    if (!workspace) return null
    return ctx.runQuery(this.component.lib.getStoredAsset, {
      workspace,
      assetId: args.assetId,
      versionId: args.versionId,
    })
  }

  async listStoredAssetsForAssembly(
    ctx: RunQueryCtx,
    args: { assemblyId: string; limit?: number },
  ) {
    return ctx.runQuery(this.component.lib.listStoredAssetsForAssembly, args)
  }

  /** Hides expired assets immediately; their rows remain until Storage confirms deletion. */
  async requestStoredAssetDeletion(
    ctx: RunMutationCtx,
    args: { album: string; createdBefore: number; limit?: number },
  ) {
    return ctx.runMutation(this.component.lib.requestStoredAssetDeletion, args)
  }

  async listStoredAssetDeletions(
    ctx: RunQueryCtx,
    args: { album: string; paginationOpts: PaginationOptions },
  ) {
    return ctx.runQuery(this.component.lib.listStoredAssetDeletions, args)
  }

  async completeStoredAssetDeletion(ctx: RunMutationCtx, args: StoredAssetReference) {
    return ctx.runMutation(this.component.lib.completeStoredAssetDeletion, args)
  }

  async failStoredAssetDeletion(
    ctx: RunMutationCtx,
    args: StoredAssetReference & { error: string },
  ) {
    return ctx.runMutation(this.component.lib.failStoredAssetDeletion, args)
  }

  async storeAssemblyMetadata(
    ctx: RunMutationCtx,
    args: ObjectType<typeof vStoreAssemblyMetadataArgs>,
  ) {
    return ctx.runMutation(this.component.lib.storeAssemblyMetadata, args)
  }

  api() {
    return makeTransloaditAPI(this.component, this.config)
  }
}

export class Transloadit extends TransloaditClient {}

/**
 * @deprecated Prefer `new Transloadit(...)` or `makeTransloaditAPI(...)`.
 */
export function createTransloadit(
  component: TransloaditComponent,
  config?: Partial<TransloaditConfig>,
) {
  return new Transloadit(component, config)
}

export function makeTransloaditAPI(
  component: TransloaditComponent,
  config?: Partial<TransloaditConfig>,
) {
  const resolveConfig = (): TransloaditConfig => ({
    authKey: config?.authKey ?? requireEnv(['TRANSLOADIT_KEY']),
    authSecret: config?.authSecret ?? requireEnv(['TRANSLOADIT_SECRET']),
    storageWorkspace: config?.storageWorkspace ?? optionalEnv('TRANSLOADIT_WORKSPACE'),
  })
  const resolveStorage = (resolved: TransloaditConfig): StorageConfig | undefined =>
    resolved.storageWorkspace ? { workspace: resolved.storageWorkspace } : undefined
  // Stored asset reads are intentionally absent: expose receipts only through app-authorized queries.

  return {
    createAssembly: actionGeneric({
      args: vCreateAssemblyArgs,
      returns: vCreateAssemblyReturn,
      handler: async (ctx, args) => {
        const resolvedConfig = resolveConfig()
        return ctx.runAction(component.lib.createAssembly, {
          ...args,
          config: { authKey: resolvedConfig.authKey, authSecret: resolvedConfig.authSecret },
        })
      },
    }),
    createAssemblyOptions: actionGeneric({
      args: vCreateAssemblyArgs,
      returns: vAssemblyOptions,
      handler: async (ctx, args) => {
        const resolvedConfig = resolveConfig()
        return ctx.runAction(component.lib.createAssemblyOptions, {
          ...args,
          config: { authKey: resolvedConfig.authKey, authSecret: resolvedConfig.authSecret },
        })
      },
    }),
    handleWebhook: actionGeneric({
      args: vWebhookActionArgs,
      returns: vWebhookResponse,
      handler: async (ctx, args) => {
        const resolvedConfig = resolveConfig()
        return ctx.runAction(component.lib.handleWebhook, {
          ...args,
          config: { authSecret: resolvedConfig.authSecret },
          storage: resolveStorage(resolvedConfig),
        })
      },
    }),
    queueWebhook: actionGeneric({
      args: vWebhookActionArgs,
      returns: vQueueWebhookResponse,
      handler: async (ctx, args) => {
        const resolvedConfig = resolveConfig()
        return ctx.runAction(component.lib.queueWebhook, {
          ...args,
          config: { authSecret: resolvedConfig.authSecret },
          storage: resolveStorage(resolvedConfig),
        })
      },
    }),
    refreshAssembly: actionGeneric({
      args: vAssemblyIdArgs,
      returns: vWebhookResponse,
      handler: async (ctx, args) => {
        const resolvedConfig = resolveConfig()
        return ctx.runAction(component.lib.refreshAssembly, {
          ...args,
          config: { authKey: resolvedConfig.authKey, authSecret: resolvedConfig.authSecret },
          storage: resolveStorage(resolvedConfig),
        })
      },
    }),
    getAssemblyStatus: queryGeneric({
      args: vAssemblyIdArgs,
      returns: v.union(vAssemblyResponse, v.null()),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.getAssemblyStatus, args)
      },
    }),
    listAssemblies: queryGeneric({
      args: vListAssembliesArgs,
      returns: v.array(vAssemblyResponse),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.listAssemblies, args)
      },
    }),
    listResults: queryGeneric({
      args: vListResultsArgs,
      returns: v.array(vAssemblyResultResponse),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.listResults, args)
      },
    }),
    listAlbumResults: queryGeneric({
      args: vListAlbumResultsArgs,
      returns: v.array(vAssemblyResultResponse),
      handler: async (ctx, args) => {
        return ctx.runQuery(component.lib.listAlbumResults, args)
      },
    }),
    purgeAlbum: mutationGeneric({
      args: vPurgeAlbumArgs,
      returns: vPurgeAlbumResponse,
      handler: async (ctx, args) => {
        return ctx.runMutation(component.lib.purgeAlbum, args)
      },
    }),
    storeAssemblyMetadata: mutationGeneric({
      args: vStoreAssemblyMetadataArgs,
      returns: v.union(vAssemblyResponse, v.null()),
      handler: async (ctx, args) => {
        return ctx.runMutation(component.lib.storeAssemblyMetadata, args)
      },
    }),
  }
}
