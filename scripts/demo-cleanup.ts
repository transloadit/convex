// Demo cleanup across Convex, Transloadit Storage and R2. A reference is released (kept only as a
// tombstone) solely after Storage confirms the deletion, so an interrupted run is always safe to
// repeat and nothing outside this deployment's demo prefix is ever deleted or forgotten.

export type StorageDeletion = {
  workspace: string
  assetId: string
  paths: string[]
  deletionAttempts: number
  deletionError?: string
}

export type CleanupConvex = {
  summary: (args: { createdBefore: number }) => Promise<{
    visibleStoredAssets: number
    expiredStoredAssets: number
    results: number
    truncated: boolean
    /** This deployment's album prefix, computed by the backend that chose the upload paths. */
    storagePrefix: string
  }>
  requestStorageDeletion: (args: {
    createdBefore: number
    limit: number
  }) => Promise<{ requested: { workspace: string; assetId: string }[]; hasMore: boolean }>
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
  purgeAlbum: () => Promise<{ deletedResults: number; deletedAssemblies: number }>
}

export type CleanupStorage = {
  workspace: string
  list: (prefix: string) => Promise<{ asset_id: string; path: string }[]>
  /** The asset's current path, or null when Storage no longer has it. */
  currentPath: (assetId: string) => Promise<string | null>
  delete: (assetId: string) => Promise<void>
}

export type CleanupR2 = {
  list: () => Promise<string[]>
  delete: (keys: string[]) => Promise<void>
}

export type CleanupOptions = {
  dryRun: boolean
  /** Undefined resets the whole demo album; a number expires Storage assets older than this. */
  olderThanMs?: number
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
  const { convex, storage, r2 } = deps
  const now = options.now ?? Date.now()
  const batchSize = options.batchSize ?? 100
  const reset = options.olderThanMs === undefined
  const createdBefore = reset ? now + 1 : now - (options.olderThanMs ?? 0)
  const summary = await convex.summary({ createdBefore })
  const prefix = summary.storagePrefix
  const storageObjects = storage ? await storage.list(prefix) : []
  const r2Keys = reset && r2 ? await r2.list() : []

  if (options.dryRun) {
    return {
      dryRun: true,
      mode: reset ? 'reset' : 'expire',
      createdBefore,
      convex: summary,
      storage: storage
        ? {
            workspace: storage.workspace,
            prefix,
            objects: storageObjects.length,
            wouldHide: reset ? summary.visibleStoredAssets : summary.expiredStoredAssets,
          }
        : 'disabled',
      r2: r2 ? { objects: r2Keys.length } : reset ? 'disabled' : 'unchanged',
    }
  }

  // Without Storage access nothing is hidden: hidden receipts could then never be deleted.
  const storageReport = storage
    ? await (async () => {
        // 1. Hide first: expired photos leave the gallery and delivery before bytes are deleted.
        let hidden = 0
        for (;;) {
          const batch = await convex.requestStorageDeletion({ createdBefore, limit: batchSize })
          hidden += batch.requested.length
          if (!batch.hasMore) break
        }
        // 2. Delete Storage assets, then record it. Failures stay hidden and retryable.
        const ledger = await drainStorageLedger(convex, storage, prefix, batchSize)
        // 3. A reset also removes unregistered uploads under this prefix, such as failed
        // Assemblies. It is an operator tool for an idle demo: an upload that completes during
        // the sweep can lose its bytes, so pause uploads (or accept that) before resetting.
        let orphans = 0
        if (reset) {
          for (const object of await storage.list(prefix)) {
            try {
              await storage.delete(object.asset_id)
              orphans += 1
            } catch (error) {
              if (!isNotFound(error)) throw error
            }
          }
        }
        return { hidden, ...ledger, orphans }
      })()
    : undefined
  const retryNeeded =
    storageReport !== undefined && storageReport.failed + storageReport.outsidePrefix > 0

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
  }

  return {
    dryRun: false,
    mode: reset ? 'reset' : 'expire',
    createdBefore,
    storage: storageReport ?? 'disabled',
    r2: reset ? (r2 ? { deleted: r2Deleted } : 'disabled') : 'unchanged',
    convex: purged,
    retryNeeded,
  }
}
