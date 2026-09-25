import type { AssemblyStatus } from '@transloadit/zod/v3/assemblyStatus'
import type { AssemblyInstructionsInput } from '@transloadit/zod/v3/template'
import { anyApi, type FunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { parseAssemblyStatus } from '../shared/assemblyUrls.ts'
import { transloaditError } from '../shared/errors.ts'
import { getResultUrl } from '../shared/resultUtils.ts'
import {
  type ProcessWebhookResult,
  type StorageConfig,
  vAssembly,
  vAssemblyBaseArgs,
  vAssemblyIdArgs,
  vAssemblyOptions,
  vAssemblyResult,
  vCompleteStoredAssetDeletionArgs,
  vCreateAssemblyReturn,
  vFailStoredAssetDeletionArgs,
  vGetStoredAssetArgs,
  vHandleWebhookArgs,
  vListAlbumResultsArgs,
  vListAssembliesArgs,
  vListResultsArgs,
  vListStoredAssetDeletionsArgs,
  vListStoredAssetsArgs,
  vListStoredAssetsForAssemblyArgs,
  vPurgeAlbumArgs,
  vPurgeAlbumResponse,
  vQueueWebhookResponse,
  vRefreshAssemblyArgs,
  vRegisterStoredAssetsArgs,
  vRegisterStoredAssetsResponse,
  vReplaceResultsArgs,
  vRequestStoredAssetDeletionArgs,
  vRequestStoredAssetDeletionResponse,
  vStoreAssemblyMetadataArgs,
  vStoredAssetDeletion,
  vStoredAssetPage,
  vStoredAssetRow,
  vTransloaditConfig,
  vUpsertAssemblyArgs,
  vWebhookArgs,
  vWebhookResponse,
} from '../shared/schemas.ts'
import { selectStoredAssets } from '../shared/storedAssets.ts'
import type { Doc } from './_generated/dataModel.ts'
import {
  action,
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from './_generated/server.ts'
import {
  buildTransloaditParams,
  flattenResults,
  signTransloaditParams,
  verifyWebhookSignature,
} from './apiUtils.ts'

const TRANSLOADIT_ASSEMBLY_URL = 'https://api2.transloadit.com/assemblies'

export type { Assembly, AssemblyResult } from '../shared/schemas.ts'
export { vAssembly, vAssemblyResult, vTransloaditConfig }

type InternalApi = {
  lib: {
    upsertAssembly: FunctionReference<'mutation', 'internal', Record<string, unknown>, unknown>
    replaceResultsForAssembly: FunctionReference<
      'mutation',
      'internal',
      Record<string, unknown>,
      unknown
    >
    registerStoredAssets: FunctionReference<
      'mutation',
      'internal',
      Record<string, unknown>,
      { inserted: number; existing: number }
    >
    processWebhook: FunctionReference<
      'action',
      'internal',
      Record<string, unknown>,
      ProcessWebhookResult
    >
  }
}

const internal = anyApi as unknown as InternalApi

const resolveAssemblyId = (payload: AssemblyStatus): string => {
  if (typeof payload.assembly_id === 'string') return payload.assembly_id
  if (typeof payload.assemblyId === 'string') return payload.assemblyId
  return ''
}

const getFieldString = (fields: unknown, key: string): string | undefined => {
  if (!fields || typeof fields !== 'object') return undefined
  const value = (fields as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const parseAssemblyPayload = (payload: unknown): AssemblyStatus => {
  const parsed = parseAssemblyStatus(payload)
  if (!parsed) {
    throw transloaditError('payload', 'Invalid Transloadit payload')
  }
  return parsed
}

// Always persist the signed bytes, never an independently supplied payload.
const parseWebhookPayload = async (args: {
  payload: unknown
  rawBody?: string
  signature?: string
  verifySignature?: boolean
  authSecret?: string
}): Promise<AssemblyStatus> => {
  if (args.verifySignature === false) return parseAssemblyPayload(args.payload)
  if (!args.rawBody) {
    throw transloaditError('webhook', 'Missing rawBody for webhook verification')
  }
  const authSecret = args.authSecret ?? process.env.TRANSLOADIT_SECRET
  if (!authSecret) {
    throw transloaditError('webhook', 'Missing TRANSLOADIT_SECRET for webhook validation')
  }
  const verified = await verifyWebhookSignature({
    rawBody: args.rawBody,
    signatureHeader: args.signature,
    authSecret,
  })
  if (!verified) {
    throw transloaditError('webhook', 'Invalid Transloadit webhook signature')
  }
  let payload: unknown
  try {
    payload = JSON.parse(args.rawBody)
  } catch {
    throw transloaditError('webhook', 'Invalid JSON in signed webhook body')
  }
  return parseAssemblyPayload(payload)
}

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
  })
  const signature = await signTransloaditParams(params, authSecret)
  const url = new URL(`${TRANSLOADIT_ASSEMBLY_URL}/${assemblyId}`)
  url.searchParams.set('signature', signature)
  url.searchParams.set('params', params)
  return url.toString()
}

const applyAssemblyStatus = async (
  ctx: Pick<import('./_generated/server.ts').ActionCtx, 'runMutation'>,
  payload: AssemblyStatus,
  storage?: StorageConfig,
) => {
  const assemblyId = resolveAssemblyId(payload)
  if (!assemblyId) {
    throw transloaditError('webhook', 'Webhook payload missing assembly_id')
  }

  // Verify every Storage receipt before persisting anything: one invalid or cross-Workspace record
  // fails the whole status update. Unfinished or failed Assemblies register no assets.
  const storedAssets =
    storage && payload.ok === 'ASSEMBLY_COMPLETED' && typeof payload.error !== 'string'
      ? selectStoredAssets(payload, storage)
      : []

  const results = flattenResults(payload.results ?? undefined)

  await ctx.runMutation(internal.lib.upsertAssembly, {
    assemblyId,
    status: typeof payload.ok === 'string' ? payload.ok : undefined,
    ok: typeof payload.ok === 'string' ? payload.ok : undefined,
    message: typeof payload.message === 'string' ? payload.message : undefined,
    templateId: typeof payload.template_id === 'string' ? payload.template_id : undefined,
    notifyUrl: typeof payload.notify_url === 'string' ? payload.notify_url : undefined,
    fields: payload.fields,
    uploads: payload.uploads,
    results: payload.results,
    error: payload.error,
    raw: payload,
    userId:
      typeof payload.user_id === 'string'
        ? payload.user_id
        : getFieldString(payload.fields, 'userId'),
  })

  await ctx.runMutation(internal.lib.replaceResultsForAssembly, {
    assemblyId,
    results,
  })

  if (storedAssets.length > 0) {
    await ctx.runMutation(internal.lib.registerStoredAssets, {
      album: getFieldString(payload.fields, 'album'),
      userId: getFieldString(payload.fields, 'userId'),
      uploadId: getFieldString(payload.fields, 'uploadId'),
      assets: storedAssets,
    })
  }

  return {
    assemblyId,
    resultCount: results.length,
    ...(storage ? { storedAssetCount: storedAssets.length } : {}),
    ok: typeof payload.ok === 'string' ? payload.ok : undefined,
    status: typeof payload.ok === 'string' ? payload.ok : undefined,
  }
}

const findStoredAssetRows = (
  ctx: Pick<MutationCtx, 'db'>,
  workspace: string,
  assetId: string,
): Promise<Doc<'storedAssets'>[]> =>
  ctx.db
    .query('storedAssets')
    .withIndex('by_version', (q) =>
      q.eq('asset.workspace', workspace).eq('asset.asset_id', assetId),
    )
    .collect()

export const upsertAssembly = internalMutation({
  args: vUpsertAssemblyArgs,
  returns: v.id('assemblies'),
  handler: async (ctx, args) => {
    // Note: we persist full `raw` + `results` for debugging/fidelity. Large
    // assemblies can hit Convex document size limits; trim or externalize
    // payloads if this becomes an issue for your workload.
    const existing = await ctx.db
      .query('assemblies')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .unique()

    const now = Date.now()
    if (!existing) {
      return await ctx.db.insert('assemblies', {
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
      })
    }

    await ctx.db.patch(existing._id, {
      status: args.status ?? existing.status,
      ok: args.ok ?? existing.ok,
      message: args.message ?? existing.message,
      templateId: args.templateId ?? existing.templateId,
      notifyUrl: args.notifyUrl ?? existing.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles ?? existing.numExpectedUploadFiles,
      fields: args.fields ?? existing.fields,
      uploads: args.uploads ?? existing.uploads,
      results: args.results ?? existing.results,
      error: args.error ?? existing.error,
      raw: args.raw ?? existing.raw,
      userId: args.userId ?? existing.userId,
      updatedAt: now,
    })

    return existing._id
  },
})

export const replaceResultsForAssembly = internalMutation({
  args: vReplaceResultsArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    // We store raw result payloads for fidelity. For very large assemblies,
    // consider trimming or externalizing these fields to avoid size limits.
    // This mutation replaces all results in one transaction; extremely large
    // result sets may need batching or external storage to avoid Convex limits.
    const existingResults = await ctx.db
      .query('results')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .collect()

    for (const existing of existingResults) {
      await ctx.db.delete(existing._id)
    }

    const assembly = await ctx.db
      .query('assemblies')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .unique()
    const album = getFieldString(assembly?.fields, 'album')
    const userId =
      typeof assembly?.userId === 'string'
        ? assembly.userId
        : getFieldString(assembly?.fields, 'userId')

    const now = Date.now()
    for (const entry of args.results) {
      const raw = entry.result as Record<string, unknown>
      const sslUrl = getResultUrl(entry.result)
      await ctx.db.insert('results', {
        assemblyId: args.assemblyId,
        album,
        userId,
        stepName: entry.stepName,
        resultId: typeof raw.id === 'string' ? raw.id : undefined,
        sslUrl,
        name: typeof raw.name === 'string' ? raw.name : undefined,
        size: typeof raw.size === 'number' ? raw.size : undefined,
        mime: typeof raw.mime === 'string' ? raw.mime : undefined,
        raw,
        createdAt: now,
      })
    }

    return null
  },
})

// Idempotent by Workspace, asset and version: notification retries and refreshes are harmless.
export const registerStoredAssets = internalMutation({
  args: vRegisterStoredAssetsArgs,
  returns: vRegisterStoredAssetsResponse,
  handler: async (ctx, args) => {
    let inserted = 0
    let existing = 0
    const now = Date.now()
    for (const entry of args.assets) {
      const known = await findStoredAssetRows(ctx, entry.asset.workspace, entry.asset.asset_id)
      // A known version is a replay. Any version of an asset that is being or has been deleted is
      // never registered again: late notifications must not bring deleted media back.
      if (
        known.some(
          (row) =>
            row.asset.version_id === entry.asset.version_id ||
            row.deletionRequestedAt !== undefined,
        )
      ) {
        existing += 1
        continue
      }
      await ctx.db.insert('storedAssets', {
        ...entry,
        album: args.album,
        userId: args.userId,
        uploadId: args.uploadId,
        createdAt: now,
      })
      inserted += 1
    }
    return { inserted, existing }
  },
})

export const createAssembly = action({
  args: {
    config: vTransloaditConfig,
    ...vAssemblyBaseArgs,
  },
  returns: vCreateAssemblyReturn,
  handler: async (ctx, args) => {
    const { paramsString, params } = buildTransloaditParams({
      authKey: args.config.authKey,
      templateId: args.templateId,
      steps: args.steps as AssemblyInstructionsInput['steps'],
      fields: args.fields as AssemblyInstructionsInput['fields'],
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles,
      expires: args.expires,
      additionalParams: args.additionalParams as Record<string, unknown> | undefined,
    })

    const signature = await signTransloaditParams(paramsString, args.config.authSecret)

    const formData = new FormData()
    formData.append('params', paramsString)
    formData.append('signature', signature)
    if (typeof args.numExpectedUploadFiles === 'number') {
      formData.append('tus_num_expected_upload_files', String(args.numExpectedUploadFiles))
    }

    const response = await fetch(TRANSLOADIT_ASSEMBLY_URL, {
      method: 'POST',
      body: formData,
    })

    const data = (await response.json()) as Record<string, unknown>
    if (!response.ok) {
      throw transloaditError('createAssembly', `HTTP ${response.status}: ${JSON.stringify(data)}`)
    }

    const assemblyId =
      typeof data.assembly_id === 'string'
        ? data.assembly_id
        : typeof data.assemblyId === 'string'
          ? data.assemblyId
          : ''

    if (!assemblyId) {
      throw transloaditError('createAssembly', 'Transloadit response missing assembly_id')
    }

    await ctx.runMutation(internal.lib.upsertAssembly, {
      assemblyId,
      status: typeof data.ok === 'string' ? data.ok : undefined,
      ok: typeof data.ok === 'string' ? data.ok : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
      templateId: args.templateId,
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles,
      fields: params.fields,
      uploads: data.uploads,
      results: data.results,
      error: data.error,
      raw: data,
      userId: args.userId,
    })

    return { assemblyId, data }
  },
})

export const createAssemblyOptions = action({
  args: {
    config: vTransloaditConfig,
    ...vAssemblyBaseArgs,
  },
  returns: vAssemblyOptions,
  handler: async (_ctx, args) => {
    const { paramsString, params } = buildTransloaditParams({
      authKey: args.config.authKey,
      templateId: args.templateId,
      steps: args.steps as AssemblyInstructionsInput['steps'],
      fields: args.fields as AssemblyInstructionsInput['fields'],
      notifyUrl: args.notifyUrl,
      numExpectedUploadFiles: args.numExpectedUploadFiles,
      expires: args.expires,
      additionalParams: args.additionalParams as Record<string, unknown> | undefined,
    })

    const signature = await signTransloaditParams(paramsString, args.config.authSecret)

    const fields =
      params && typeof params.fields === 'object' && params.fields
        ? (params.fields as Record<string, unknown>)
        : undefined

    return {
      params: paramsString,
      signature,
      fields,
    }
  },
})

export const processWebhook = internalAction({
  args: vWebhookArgs,
  returns: vWebhookResponse,
  handler: async (ctx, args) => {
    const parsed = await parseWebhookPayload(args)
    return applyAssemblyStatus(ctx, parsed, args.storage)
  },
})

export const handleWebhook = action({
  args: vHandleWebhookArgs,
  returns: vWebhookResponse,
  handler: async (ctx, args) => {
    const verifySignature = args.verifySignature ?? true
    return ctx.runAction(internal.lib.processWebhook, {
      payload: args.payload,
      rawBody: args.rawBody,
      signature: args.signature,
      verifySignature,
      authSecret: args.config?.authSecret,
      storage: args.storage,
    })
  },
})

export const queueWebhook = action({
  args: vHandleWebhookArgs,
  returns: vQueueWebhookResponse,
  handler: async (ctx, args) => {
    const parsed = await parseWebhookPayload({
      ...args,
      authSecret: args.config?.authSecret,
    })
    const assemblyId = resolveAssemblyId(parsed)
    if (!assemblyId) {
      throw transloaditError('webhook', 'Webhook payload missing assembly_id')
    }

    await ctx.scheduler.runAfter(0, internal.lib.processWebhook, {
      payload: parsed,
      rawBody: args.rawBody,
      signature: args.signature,
      verifySignature: args.verifySignature ?? true,
      authSecret: args.config?.authSecret,
      storage: args.storage,
    })

    return { assemblyId, queued: true }
  },
})

export const refreshAssembly = action({
  args: vRefreshAssemblyArgs,
  returns: vWebhookResponse,
  handler: async (ctx, args) => {
    const { assemblyId } = args
    const authKey = args.config?.authKey ?? process.env.TRANSLOADIT_KEY
    const authSecret = args.config?.authSecret ?? process.env.TRANSLOADIT_SECRET
    const url =
      authKey && authSecret
        ? await buildSignedAssemblyUrl(assemblyId, authKey, authSecret)
        : `${TRANSLOADIT_ASSEMBLY_URL}/${assemblyId}`

    const response = await fetch(url)
    const payload = parseAssemblyPayload(await response.json())
    if (!response.ok) {
      throw transloaditError('status', `HTTP ${response.status}: ${JSON.stringify(payload)}`)
    }

    // App wrappers can restrict refreshes before any status/results are persisted.
    for (const [field, expected] of Object.entries(args.expectedFields ?? {})) {
      if (getFieldString(payload.fields, field) !== expected) {
        throw transloaditError('status', 'Assembly does not match the expected fields')
      }
    }

    return applyAssemblyStatus(ctx, payload, args.storage)
  },
})

export const getAssemblyStatus = query({
  args: vAssemblyIdArgs,
  returns: v.union(vAssembly, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('assemblies')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .unique()
  },
})

export const listAssemblies = query({
  args: vListAssembliesArgs,
  returns: v.array(vAssembly),
  handler: async (ctx, args) => {
    if (args.userId) {
      return ctx.db
        .query('assemblies')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId))
        .order('desc')
        .take(args.limit ?? 50)
    }
    if (args.status) {
      return ctx.db
        .query('assemblies')
        .withIndex('by_status', (q) => q.eq('status', args.status))
        .order('desc')
        .take(args.limit ?? 50)
    }

    return ctx.db
      .query('assemblies')
      .order('desc')
      .take(args.limit ?? 50)
  },
})

export const listResults = query({
  args: vListResultsArgs,
  returns: v.array(vAssemblyResult),
  handler: async (ctx, args) => {
    if (args.stepName) {
      const stepName = args.stepName
      return ctx.db
        .query('results')
        .withIndex('by_assemblyId_and_step', (q) =>
          q.eq('assemblyId', args.assemblyId).eq('stepName', stepName),
        )
        .order('desc')
        .take(args.limit ?? 200)
    }

    return ctx.db
      .query('results')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .order('desc')
      .take(args.limit ?? 200)
  },
})

export const listAlbumResults = query({
  args: vListAlbumResultsArgs,
  returns: v.array(vAssemblyResult),
  handler: async (ctx, args) => {
    return ctx.db
      .query('results')
      .withIndex('by_album', (q) => q.eq('album', args.album))
      .order('desc')
      .take(args.limit ?? 200)
  },
})

export const purgeAlbum = mutation({
  args: vPurgeAlbumArgs,
  returns: vPurgeAlbumResponse,
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query('results')
      .withIndex('by_album', (q) => q.eq('album', args.album))
      .collect()
    const assemblyIds = new Set<string>()

    for (const result of results) {
      assemblyIds.add(result.assemblyId)
      await ctx.db.delete(result._id)
    }

    let deletedAssemblies = 0
    if (args.deleteAssemblies ?? true) {
      for (const assemblyId of assemblyIds) {
        const assembly = await ctx.db
          .query('assemblies')
          .withIndex('by_assemblyId', (q) => q.eq('assemblyId', assemblyId))
          .unique()
        if (assembly) {
          await ctx.db.delete(assembly._id)
          deletedAssemblies += 1
        }
      }
    }

    return { deletedResults: results.length, deletedAssemblies }
  },
})

export const storeAssemblyMetadata = mutation({
  args: vStoreAssemblyMetadataArgs,
  returns: v.union(vAssembly, v.null()),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('assemblies')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .unique()

    if (!existing) {
      return null
    }

    await ctx.db.patch(existing._id, {
      userId: args.userId ?? existing.userId,
      fields: args.fields ?? existing.fields,
      updatedAt: Date.now(),
    })

    return {
      ...existing,
      userId: args.userId ?? existing.userId,
      fields: args.fields ?? existing.fields,
    }
  },
})

/** Visible Storage receipts of one album, newest first, from local indexed data only. */
export const listStoredAssets = query({
  args: vListStoredAssetsArgs,
  returns: vStoredAssetPage,
  handler: async (ctx, args) => {
    return ctx.db
      .query('storedAssets')
      .withIndex('by_album_visibility', (q) =>
        q.eq('album', args.album).eq('deletionRequestedAt', undefined),
      )
      .order('desc')
      .paginate(args.paginationOpts)
  },
})

/** One exact visible version; rows awaiting deletion are never returned for delivery. */
export const getStoredAsset = query({
  args: vGetStoredAssetArgs,
  returns: v.union(vStoredAssetRow, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('storedAssets')
      .withIndex('by_version', (q) =>
        q
          .eq('asset.workspace', args.workspace)
          .eq('asset.asset_id', args.assetId)
          .eq('asset.version_id', args.versionId),
      )
      .first()
    return row && row.deletionRequestedAt === undefined ? row : null
  },
})

export const listStoredAssetsForAssembly = query({
  args: vListStoredAssetsForAssemblyArgs,
  returns: v.array(vStoredAssetRow),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('storedAssets')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .take(Math.min(Math.max(args.limit ?? 200, 1), 500))
    return rows.filter((row) => row.deletionRequestedAt === undefined)
  },
})

/**
 * First step of the deletion ledger: hide every version of expired assets immediately. Rows stay
 * until the Storage deletion is confirmed, so an interrupted cleanup can always be retried.
 */
export const requestStoredAssetDeletion = mutation({
  args: vRequestStoredAssetDeletionArgs,
  returns: vRequestStoredAssetDeletionResponse,
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500)
    const candidates = await ctx.db
      .query('storedAssets')
      .withIndex('by_album_visibility', (q) =>
        q
          .eq('album', args.album)
          .eq('deletionRequestedAt', undefined)
          .lt('createdAt', args.createdBefore),
      )
      .take(limit + 1)
    const now = Date.now()
    const requested = new Map<string, { workspace: string; assetId: string }>()
    for (const candidate of candidates.slice(0, limit)) {
      const { workspace, asset_id: assetId } = candidate.asset
      const key = JSON.stringify([workspace, assetId])
      if (requested.has(key)) continue
      requested.set(key, { workspace, assetId })
      // Storage deletes whole assets, so every locally known version is hidden together.
      for (const row of await findStoredAssetRows(ctx, workspace, assetId)) {
        if (row.deletionRequestedAt === undefined) {
          await ctx.db.patch(row._id, { deletionRequestedAt: now })
        }
      }
    }
    return { requested: [...requested.values()], hasMore: candidates.length > limit }
  },
})

export const listStoredAssetDeletions = query({
  args: vListStoredAssetDeletionsArgs,
  returns: v.array(vStoredAssetDeletion),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500)
    const rows = await ctx.db
      .query('storedAssets')
      .withIndex('by_pending_deletion', (q) =>
        q.eq('deletedAt', undefined).gt('deletionRequestedAt', 0),
      )
      .take(limit)
    const pending = new Map<string, typeof vStoredAssetDeletion.type>()
    for (const row of rows) {
      const { workspace, asset_id: assetId, path } = row.asset
      const key = JSON.stringify([workspace, assetId])
      const entry = pending.get(key) ?? {
        workspace,
        assetId,
        paths: [],
        rows: 0,
        deletionRequestedAt: row.deletionRequestedAt ?? 0,
        deletionAttempts: row.deletionAttempts ?? 0,
        deletionError: row.deletionError,
      }
      if (!entry.paths.includes(path)) entry.paths.push(path)
      entry.rows += 1
      pending.set(key, entry)
    }
    return [...pending.values()]
  },
})

/**
 * Call only after Storage confirmed the deletion. Rows become tombstones: they leave the ledger,
 * drop their ThumbHash and keep only the identity that stops late notifications resurrecting them.
 */
export const completeStoredAssetDeletion = mutation({
  args: vCompleteStoredAssetDeletionArgs,
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const rows = await findStoredAssetRows(ctx, args.workspace, args.assetId)
    if (rows.some((row) => row.deletionRequestedAt === undefined)) {
      throw transloaditError('storage', 'Request deletion before completing it')
    }
    const now = Date.now()
    let deleted = 0
    for (const row of rows) {
      if (row.deletedAt !== undefined) continue
      const { thumbhash: _thumbhash, ...asset } = row.asset
      await ctx.db.patch(row._id, { asset, deletedAt: now, deletionError: undefined })
      deleted += 1
    }
    return { deleted }
  },
})

export const failStoredAssetDeletion = mutation({
  args: vFailStoredAssetDeletionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const row of await findStoredAssetRows(ctx, args.workspace, args.assetId)) {
      if (row.deletionRequestedAt === undefined || row.deletedAt !== undefined) continue
      await ctx.db.patch(row._id, {
        deletionAttempts: (row.deletionAttempts ?? 0) + 1,
        deletionError: args.error.slice(0, 500),
      })
    }
    return null
  },
})
