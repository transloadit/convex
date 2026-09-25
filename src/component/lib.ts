import type { AssemblyStatus } from '@transloadit/zod/v3/assemblyStatus'
import type { AssemblyInstructionsInput } from '@transloadit/zod/v3/template'
import type { IndexRangeBuilder, PaginationOptions } from 'convex/server'
import { anyApi, type FunctionReference } from 'convex/server'
import { ConvexError, type ObjectType, v } from 'convex/values'
import { paginator } from 'convex-helpers/server/pagination'
import { parseAssemblyStatus } from '../shared/assemblyUrls.ts'
import { transloaditError } from '../shared/errors.ts'
import { getResultUrl } from '../shared/resultUtils.ts'
import {
  type ProcessWebhookResult,
  type StorageConfig,
  vAdoptStoredAssetsArgs,
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
  type vStoredAssetDeletion,
  vStoredAssetDeletionPage,
  vStoredAssetPage,
  vStoredAssetRow,
  vTransloaditConfig,
  vUpsertAssemblyArgs,
  vWebhookArgs,
  vWebhookResponse,
} from '../shared/schemas.ts'
import { selectStoredAssets } from '../shared/storedAssets.ts'
import type { DataModel, Doc } from './_generated/dataModel.ts'
import {
  action,
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server.ts'
import {
  buildTransloaditParams,
  flattenResults,
  signTransloaditParams,
  verifyWebhookSignature,
} from './apiUtils.ts'
import schema from './schema.ts'

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
    persistAssemblyStatus: FunctionReference<'mutation', 'internal', Record<string, unknown>, null>
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
  // A completed Assembly whose status omits results simply has no receipts to register.
  const storedAssets =
    storage &&
    payload.ok === 'ASSEMBLY_COMPLETED' &&
    typeof payload.error !== 'string' &&
    payload.results
      ? selectStoredAssets(payload, storage)
      : []

  const results = flattenResults(payload.results ?? undefined)

  // Status, results and receipts are one transaction: a completed status never lacks its receipts.
  const assembly = {
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
  }
  await ctx.runMutation(internal.lib.persistAssemblyStatus, {
    assembly,
    results,
    storedAssets: {
      album: getFieldString(payload.fields, 'album'),
      userId: getFieldString(payload.fields, 'userId'),
      uploadId: getFieldString(payload.fields, 'uploadId'),
      assets: storedAssets,
    },
  })

  return {
    assemblyId,
    resultCount: results.length,
    ...(storage ? { storedAssetCount: storedAssets.length } : {}),
    ok: typeof payload.ok === 'string' ? payload.ok : undefined,
    status: typeof payload.ok === 'string' ? payload.ok : undefined,
  }
}

const findStoredAssetRows = (
  ctx: { db: QueryCtx['db'] },
  workspace: string,
  assetId: string,
): Promise<Doc<'storedAssets'>[]> =>
  ctx.db
    .query('storedAssets')
    .withIndex('by_version', (q) =>
      q.eq('asset.workspace', workspace).eq('asset.asset_id', assetId),
    )
    .collect()

const writeAssembly = async (ctx: MutationCtx, args: ObjectType<typeof vUpsertAssemblyArgs>) => {
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
}

export const upsertAssembly = internalMutation({
  args: vUpsertAssemblyArgs,
  returns: v.id('assemblies'),
  handler: writeAssembly,
})

const writeResults = async (ctx: MutationCtx, args: ObjectType<typeof vReplaceResultsArgs>) => {
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
}

export const replaceResultsForAssembly = internalMutation({
  args: vReplaceResultsArgs,
  returns: v.null(),
  handler: writeResults,
})

// Idempotent by Workspace, asset and version: notification retries and refreshes are harmless.
const writeStoredAssets = async (
  ctx: MutationCtx,
  args: ObjectType<typeof vRegisterStoredAssetsArgs>,
) => {
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
          row.asset.version_id === entry.asset.version_id || row.deletionRequestedAt !== undefined,
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
}

export const registerStoredAssets = internalMutation({
  args: vRegisterStoredAssetsArgs,
  returns: vRegisterStoredAssetsResponse,
  handler: writeStoredAssets,
})

export const persistAssemblyStatus = internalMutation({
  args: {
    assembly: v.object(vUpsertAssemblyArgs),
    results: vReplaceResultsArgs.results,
    storedAssets: v.object(vRegisterStoredAssetsArgs),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writeAssembly(ctx, args.assembly)
    await writeResults(ctx, { assemblyId: args.assembly.assemblyId, results: args.results })
    await writeStoredAssets(ctx, args.storedAssets)
    return null
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

// The expiry scan continues mid-page from an explicit cursor. A position is [indexed time,
// _creationTime]; _creationTime breaks ties between rows registered in the same instant.
type Position = [number, number]
type VisibleRange = IndexRangeBuilder<
  Doc<'storedAssets'>,
  DataModel['storedAssets']['indexes']['by_album_visibility']
>

const parsePosition = (cursor: string | null | undefined): Position | null => {
  if (!cursor) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(cursor)
  } catch {
    parsed = undefined
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    !parsed.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw transloaditError('storage', 'Invalid Storage cursor')
  }
  return [parsed[0], parsed[1]]
}

const pageSize = (numItems: number) => Math.min(Math.max(Math.floor(numItems), 1), 500)
const emptyPosition = JSON.stringify([0, 0])

const maxRowsRead = 1000

// Components cannot use the built-in `.paginate()`; convex-helpers' paginator pages the index
// instead. Its cursors are index keys: the album, the absent deletion time, the indexed time,
// _creationTime and _id. Anything else, such as an earlier release's [time, _creationTime] tuple
// or another album's key, is refused as InvalidCursor so usePaginatedQuery restarts.
const paginationFor = (album: string | undefined, opts: PaginationOptions) => {
  // The paginator's encoding of an absent album, and of albums that end like that marker.
  const albumKey =
    album === undefined ? 'undefined' : album.endsWith('undefined') ? `_${album}` : album
  for (const cursor of [opts.cursor, opts.endCursor]) {
    if (cursor == null) continue
    let key: unknown
    try {
      key = JSON.parse(cursor)
    } catch {
      key = undefined
    }
    if (
      !Array.isArray(key) ||
      key.length !== 5 ||
      key[0] !== albumKey ||
      key[1] !== 'undefined' ||
      !Number.isFinite(key[2]) ||
      !Number.isFinite(key[3]) ||
      typeof key[4] !== 'string'
    ) {
      throw new ConvexError('InvalidCursor: restart Storage pagination')
    }
  }
  const numItems = pageSize(opts.numItems)
  return {
    numItems,
    cursor: opts.cursor,
    endCursor: opts.endCursor,
    // Clients may lower the bound on rows read, but neither raise it nor split an ordinary page.
    maximumRowsRead: Math.min(
      Math.max(opts.maximumRowsRead ?? maxRowsRead, numItems + 1),
      maxRowsRead,
    ),
  }
}

// A loaded page that outgrew the read limit must keep its end. convex-helpers 0.1.124 answers it
// with SplitRequired and a continueCursor where it stopped reading, so the client's two halves would
// drop the rest of the range (see "Storage pagination" in CONTRIBUTING.md and its regression test).
const keepLoadedRange = <Page extends { pageStatus?: string | null; continueCursor: string }>(
  page: Page,
  endCursor: string | null | undefined,
) =>
  endCursor && page.pageStatus === 'SplitRequired' ? { ...page, continueCursor: endCursor } : page

/**
 * Visible Storage receipts of one album, newest first, from local indexed data only. Pages follow
 * Convex's cursor protocol: an inclusive `endCursor` fixes a loaded page's range, so a reactive
 * client keeps earlier pages stable while new photos arrive at the top, and `pageStatus` with
 * `splitCursor` says when a loaded page has grown too large to read at once.
 */
export const listStoredAssets = query({
  args: vListStoredAssetsArgs,
  returns: vStoredAssetPage,
  handler: async (ctx, args) =>
    keepLoadedRange(
      await paginator(ctx.db, schema)
        .query('storedAssets')
        .withIndex('by_album_visibility', (q) =>
          q.eq('album', args.album).eq('deletionRequestedAt', undefined),
        )
        .order('desc')
        .paginate(paginationFor(args.album, args.paginationOpts)),
      args.paginationOpts.endCursor,
    ),
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
    return ctx.db
      .query('storedAssets')
      .withIndex('by_assemblyId', (q) => q.eq('assemblyId', args.assemblyId))
      .filter((q) => q.eq(q.field('deletionRequestedAt'), undefined))
      .take(Math.min(Math.max(args.limit ?? 200, 1), 500))
  },
})

/**
 * First step of the deletion ledger: hide every version of expired assets immediately. Rows stay
 * until the Storage deletion is confirmed, so an interrupted cleanup can always be retried.
 */
// Selects expired assets oldest first, continuing after a cursor so skipped assets are never
// scanned again. Shared by the deletion request and its read-only dry-run preview.
const selectExpiredAssets = async (
  ctx: { db: QueryCtx['db'] },
  args: ObjectType<typeof vRequestStoredAssetDeletionArgs>,
) => {
  const limit = pageSize(args.limit ?? 100)
  const scanBudget = limit * 4
  const start = parsePosition(args.cursor)
  const candidates = (q: VisibleRange) =>
    q.eq('album', args.album).eq('deletionRequestedAt', undefined)
  const rows: Doc<'storedAssets'>[] = start
    ? await ctx.db
        .query('storedAssets')
        .withIndex('by_album_visibility', (q) =>
          candidates(q).eq('createdAt', start[0]).gt('_creationTime', start[1]),
        )
        .take(scanBudget + 1)
    : []
  if (rows.length <= scanBudget) {
    rows.push(
      ...(await ctx.db
        .query('storedAssets')
        .withIndex('by_album_visibility', (q) =>
          start
            ? candidates(q).gt('createdAt', start[0]).lt('createdAt', args.createdBefore)
            : candidates(q).lt('createdAt', args.createdBefore),
        )
        .take(scanBudget + 1 - rows.length)),
    )
  }
  const expired = new Map<
    string,
    { workspace: string; assetId: string; versions: Doc<'storedAssets'>[] }
  >()
  const decided = new Set<string>()
  let last: Doc<'storedAssets'> | undefined
  let stoppedEarly = false
  for (const row of rows.slice(0, scanBudget)) {
    if (expired.size >= limit) {
      stoppedEarly = true
      break
    }
    last = row
    const { workspace, asset_id: assetId } = row.asset
    const key = JSON.stringify([workspace, assetId])
    if (decided.has(key)) continue
    decided.add(key)
    const versions = await findStoredAssetRows(ctx, workspace, assetId)
    // Expiry follows the newest version, in any album: an asset overwritten after the cutoff stays.
    if (
      versions.some(
        (version) =>
          version.deletionRequestedAt === undefined && version.createdAt >= args.createdBefore,
      )
    )
      continue
    expired.set(key, { workspace, assetId, versions })
  }
  return {
    expired: [...expired.values()],
    hasMore: stoppedEarly || rows.length > scanBudget,
    continueCursor: last
      ? JSON.stringify([last.createdAt, last._creationTime])
      : (args.cursor ?? emptyPosition),
  }
}

export const requestStoredAssetDeletion = mutation({
  args: vRequestStoredAssetDeletionArgs,
  returns: vRequestStoredAssetDeletionResponse,
  handler: async (ctx, args) => {
    const selection = await selectExpiredAssets(ctx, args)
    const now = Date.now()
    for (const { versions } of selection.expired) {
      // Storage deletes whole assets, so every locally known version is hidden together.
      for (const version of versions) {
        if (version.deletionRequestedAt === undefined) {
          await ctx.db.patch(version._id, { deletionRequestedAt: now })
        }
      }
    }
    return {
      requested: selection.expired.map(({ workspace, assetId }) => ({ workspace, assetId })),
      hasMore: selection.hasMore,
      continueCursor: selection.continueCursor,
    }
  },
})

/** Dry run of `requestStoredAssetDeletion`: the same selection, without hiding anything. */
export const previewStoredAssetExpiry = query({
  args: vRequestStoredAssetDeletionArgs,
  returns: vRequestStoredAssetDeletionResponse,
  handler: async (ctx, args) => {
    const selection = await selectExpiredAssets(ctx, args)
    return {
      requested: selection.expired.map(({ workspace, assetId }) => ({ workspace, assetId })),
      hasMore: selection.hasMore,
      continueCursor: selection.continueCursor,
    }
  },
})

/**
 * Brings Storage objects that no receipt registered (for example from failed Assemblies) into the
 * deletion ledger before they are deleted, so a late notification cannot register them again.
 */
export const adoptStoredAssetsForDeletion = mutation({
  args: vAdoptStoredAssetsArgs,
  returns: v.object({ adopted: v.number(), alreadyKnown: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now()
    let adopted = 0
    let alreadyKnown = 0
    for (const asset of args.assets) {
      const versions = await findStoredAssetRows(ctx, asset.workspace, asset.asset_id)
      if (versions.length > 0) {
        alreadyKnown += 1
        for (const version of versions) {
          if (version.deletionRequestedAt === undefined) {
            await ctx.db.patch(version._id, { deletionRequestedAt: now })
          }
        }
        continue
      }
      // No Assembly provenance is known for an adopted object; empty strings say so explicitly.
      await ctx.db.insert('storedAssets', {
        asset,
        assemblyId: '',
        stepName: '',
        resultId: '',
        album: args.album,
        createdAt: now,
        deletionRequestedAt: now,
      })
      adopted += 1
    }
    return { adopted, alreadyKnown }
  },
})

/**
 * One album's hidden assets still awaiting Storage deletion, oldest request first, paged like
 * `listStoredAssets`, so entries that keep failing never block later ones.
 */
export const listStoredAssetDeletions = query({
  args: vListStoredAssetDeletionsArgs,
  returns: vStoredAssetDeletionPage,
  handler: async (ctx, args) => {
    const { page, ...position } = keepLoadedRange(
      await paginator(ctx.db, schema)
        .query('storedAssets')
        .withIndex('by_album_pending_deletion', (q) =>
          q.eq('album', args.album).eq('deletedAt', undefined).gt('deletionRequestedAt', 0),
        )
        .paginate(paginationFor(args.album, args.paginationOpts)),
      args.paginationOpts.endCursor,
    )
    // Versions of one asset are grouped per page; callers deduplicate assets across pages.
    const pending = new Map<string, typeof vStoredAssetDeletion.type>()
    for (const row of page) {
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
    return { page: [...pending.values()], ...position }
  },
})

/**
 * Call only after Storage confirmed the deletion. Rows become tombstones: they leave the ledger and
 * drop their ThumbHash, but keep the rest of the receipt, its provenance and its album and user
 * linkage, so a late notification cannot register the version again. Nothing purges tombstones.
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
