// Demo cleanup across Convex, Transloadit Storage and R2. A reference is released (kept only as a
// tombstone) solely after Storage confirms the deletion, so an interrupted run is always safe to
// repeat and nothing outside this deployment's demo prefix is ever deleted or forgotten.

/** A canonical Storage receipt as the native catalog lists it. */
export type StorageObject = {
  workspace: string
  asset_id: string
  version_id: string
  path: string
  size: number
  mime: string | null
  md5hash?: string
  sha256?: string
  width?: number
  height?: number
  thumbhash?: string
  has_alpha?: boolean
}

export type StorageDeletion = {
  workspace: string
  assetId: string
  paths: string[]
  deletionAttempts: number
  deletionError?: string
}

export type CleanupConvex = {
  /** Result count and this deployment's album prefix, as the backend that chose upload paths. */
  summary: () => Promise<{
    results: number
    resultsTruncated: boolean
    r2Results: number
    storagePrefix: string | null
  }>
  /** One page of visible receipt versions per call, so large albums stay within transaction limits. */
  visiblePage: (args: { cursor: string | null }) => Promise<{
    count: number
    isDone: boolean
    continueCursor: string
  }>
  /** One page of the exact expiry selection, without hiding anything. */
  previewExpiry: (args: { createdBefore: number; limit: number; cursor?: string }) => Promise<{
    requested: { workspace: string; assetId: string }[]
    hasMore: boolean
    continueCursor: string
  }>
  requestStorageDeletion: (args: {
    createdBefore: number
    limit: number
    cursor?: string
  }) => Promise<{
    requested: { workspace: string; assetId: string }[]
    hasMore: boolean
    continueCursor: string
  }>
  pendingStorageDeletions: (args: { cursor: string | null; numItems: number }) => Promise<{
    page: StorageDeletion[]
    isDone: boolean
    continueCursor: string
  }>
  completeStorageDeletion: (args: { workspace: string; assetId: string }) => Promise<unknown>
  failStorageDeletion: (args: {
    workspace: string
    assetId: string
    error: string
  }) => Promise<unknown>
  /** Records unregistered objects as hidden ledger entries before anything deletes them. */
  adoptForDeletion: (assets: StorageObject[]) => Promise<{ adopted: number; alreadyKnown: number }>
  purgeAlbum: () => Promise<{ deletedResults: number; deletedAssemblies: number }>
}

export type CleanupStorage = {
  workspace: string
  list: (prefix: string) => Promise<StorageObject[]>
  /** The asset's current path, or null when Storage no longer has it. */
  currentPath: (assetId: string) => Promise<string | null>
  delete: (assetId: string) => Promise<void>
}

type DeleteObjectsResult = { Errors?: { Key?: string; Code?: string }[] }

/** S3 DeleteObjects can answer 200 with per-key errors; any error means the batch failed. */
export const deleteR2Batch = async (
  send: (keys: string[]) => Promise<DeleteObjectsResult>,
  keys: string[],
) => {
  const errors = (await send(keys)).Errors ?? []
  if (errors.length > 0) {
    const sample = errors.slice(0, 3).map((error) => `${error.Key}: ${error.Code}`)
    throw new Error(
      `R2 did not delete ${errors.length} of ${keys.length} objects (${sample.join(', ')})`,
    )
  }
}

export type CleanupR2 = {
  list: () => Promise<string[]>
  delete: (keys: string[]) => Promise<void>
}

export type CleanupOptions = {
  dryRun: boolean
  /** Explicitly leave R2 objects untouched; otherwise a reset without R2 access refuses to run. */
  skipR2?: boolean
  /** Explicitly leave Storage untouched; otherwise cleanup without Storage access refuses to run. */
  skipStorage?: boolean
  /** Undefined resets the whole demo album; a number expires Storage assets older than this. */
  olderThanMs?: number
  /** Scheduled expiry must match this exact backend namespace before touching any media. */
  expectedStoragePrefix?: string
  now?: number
  batchSize?: number
}

const errorText = (error: unknown) => {
  const e = error as { code?: unknown; message?: unknown }
  return [e?.code, e?.message ?? error].filter(Boolean).join(': ').slice(0, 500)
}

const isNotFound = (error: unknown) =>
  (error as { code?: unknown })?.code === 'DAM_RESOURCE_NOT_FOUND'

const outsidePrefix = 'Outside the demo Storage prefix'

const drainStorageLedger = async (
  convex: CleanupConvex,
  storage: CleanupStorage,
  prefix: string,
  batchSize: number,
) => {
  const report = { deleted: 0, alreadyDeleted: 0, failed: 0, outsidePrefix: 0 }
  const attempted = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    // Paginate: entries that keep failing stay pending without blocking the assets behind them.
    const pending = await convex.pendingStorageDeletions({ cursor, numItems: batchSize })
    for (const entry of pending.page) {
      const key = `${entry.workspace}:${entry.assetId}`
      if (attempted.has(key)) continue
      attempted.add(key)
      const reference = { workspace: entry.workspace, assetId: entry.assetId }
      const fail = async (error: string) => {
        await convex.failStorageDeletion({ ...reference, error })
        if (error === outsidePrefix) report.outsidePrefix += 1
        else report.failed += 1
      }
      // Receipt paths are historical: also check where the asset lives now, because the ID
      // selects the asset wherever it has moved.
      if (
        entry.workspace !== storage.workspace ||
        entry.paths.some((path) => !path.startsWith(prefix))
      ) {
        await fail(outsidePrefix)
        continue
      }
      try {
        const current = await storage.currentPath(entry.assetId)
        if (current !== null && !current.startsWith(prefix)) {
          await fail(outsidePrefix)
          continue
        }
        if (current !== null) {
          await storage.delete(entry.assetId)
          report.deleted += 1
        } else {
          report.alreadyDeleted += 1
        }
      } catch (error) {
        if (!isNotFound(error)) {
          await fail(errorText(error))
          continue
        }
        report.alreadyDeleted += 1
      }
      await convex.completeStorageDeletion(reference)
    }
    if (pending.isDone) return report
    cursor = pending.continueCursor
  }
}

export const runDemoCleanup = async (
  deps: { convex: CleanupConvex; storage?: CleanupStorage; r2?: CleanupR2 },
  options: CleanupOptions,
) => {
  const { convex } = deps
  // A skip flag leaves that backend untouched even when it is configured.
  const storage = options.skipStorage ? undefined : deps.storage
  const r2 = options.skipR2 ? undefined : deps.r2
  const now = options.now ?? Date.now()
  const batchSize = options.batchSize ?? 100
  const reset = options.olderThanMs === undefined
  const createdBefore = reset ? now + 1 : now - (options.olderThanMs ?? 0)
  // A missing backend must be skipped on purpose: forgetting references to media that cannot be
  // deleted would leave it public or orphaned.
  if (!storage && !options.skipStorage) {
    throw new Error('Storage is not configured: set TRANSLOADIT_WORKSPACE or pass --skip-storage')
  }
  if (reset && !r2 && !options.skipR2) {
    throw new Error('R2 is not configured: set the R2 variables or pass --skip-r2')
  }
  const summary = await convex.summary()
  const prefix = summary.storagePrefix ?? ''
  if (storage && !summary.storagePrefix) {
    throw new Error('This deployment has no unambiguous Storage namespace to clean up')
  }
  if (options.expectedStoragePrefix !== undefined && prefix !== options.expectedStoragePrefix) {
    throw new Error('Storage prefix does not match the expected deployment namespace')
  }
  const storageObjects = storage ? await storage.list(prefix) : []
  const r2Keys = reset && r2 ? await r2.list() : []

  if (options.dryRun) {
    // Page by page in separate transactions; each asset counts once, as in the real run.
    let visibleStoredAssets = 0
    for (let cursor: string | null = null; ; ) {
      const page = await convex.visiblePage({ cursor })
      visibleStoredAssets += page.count
      if (page.isDone) break
      cursor = page.continueCursor
    }
    const expired = new Set<string>()
    for (let cursor: string | undefined; ; ) {
      const page = await convex.previewExpiry({
        createdBefore,
        limit: batchSize,
        ...(cursor ? { cursor } : {}),
      })
      for (const entry of page.requested) expired.add(`${entry.workspace}:${entry.assetId}`)
      if (!page.hasMore) break
      cursor = page.continueCursor
    }
    return {
      dryRun: true,
      mode: reset ? 'reset' : 'expire',
      createdBefore,
      convex: { ...summary, visibleStoredAssets },
      storage: storage
        ? {
            workspace: storage.workspace,
            prefix,
            objects: storageObjects.length,
            wouldHide: expired.size,
          }
        : 'skipped',
      r2: r2 ? { objects: r2Keys.length } : reset ? 'skipped' : 'unchanged',
    }
  }

  // Without Storage access nothing is hidden: hidden receipts could then never be deleted.
  const storageReport = storage
    ? await (async () => {
        // 1. Hide first: expired photos leave the gallery and delivery before bytes are deleted.
        let hidden = 0
        let cursor: string | undefined
        for (;;) {
          const batch = await convex.requestStorageDeletion({
            createdBefore,
            limit: batchSize,
            ...(cursor ? { cursor } : {}),
          })
          hidden += batch.requested.length
          if (!batch.hasMore) break
          cursor = batch.continueCursor
        }
        // 2. A reset also removes unregistered uploads under this prefix, such as failed
        // Assemblies. They enter the ledger first, so a late notification finds a tombstone.
        // It is an operator tool for an idle demo: pause uploads before resetting.
        let orphans = 0
        if (reset) {
          const objects = await storage.list(prefix)
          for (let index = 0; index < objects.length; index += batchSize) {
            orphans += (await convex.adoptForDeletion(objects.slice(index, index + batchSize)))
              .adopted
          }
        }
        // 3. Delete Storage assets, then record it. Failures stay hidden and retryable.
        const ledger = await drainStorageLedger(convex, storage, prefix, batchSize)
        return { hidden, ...ledger, orphans }
      })()
    : undefined
  const storageIncomplete =
    storageReport !== undefined && storageReport.failed + storageReport.outsidePrefix > 0
  // Skipping R2 must not forget results that are the only references to R2 media (or when that
  // cannot be established from a truncated count).
  const r2MediaKept = reset && !r2 && (summary.r2Results > 0 || summary.resultsTruncated)
  const retryNeeded = storageIncomplete || r2MediaKept

  // 4. A reset clears R2 before the Convex results that point at it.
  let r2Deleted = 0
  let purged = { deletedResults: 0, deletedAssemblies: 0 }
  if (reset) {
    if (r2) {
      for (let index = 0; index < r2Keys.length; index += 1000) {
        const batch = r2Keys.slice(index, index + 1000)
        await r2.delete(batch)
        r2Deleted += batch.length
      }
    }
    if (!retryNeeded) purged = await convex.purgeAlbum()
    // Stored assets are never purged here: the ledger keeps Storage references until deletion.
  }

  return {
    dryRun: false,
    mode: reset ? 'reset' : 'expire',
    createdBefore,
    storage: storageReport ?? 'skipped',
    r2: reset ? (r2 ? { deleted: r2Deleted } : 'skipped') : 'unchanged',
    convex: r2MediaKept ? 'kept: results reference skipped R2 media' : purged,
    retryNeeded,
  }
}
