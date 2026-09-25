// Demo cleanup across Convex, Transloadit Storage and R2. References become tombstones only after
// the backend confirms deletion, so an interrupted run is always safe to repeat.

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
  }>
  requestStorageDeletion: (args: {
    createdBefore: number
    limit: number
  }) => Promise<{ requested: { workspace: string; assetId: string }[]; hasMore: boolean }>
  pendingStorageDeletions: (args: { limit: number }) => Promise<StorageDeletion[]>
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
  /** Only assets under this deployment's demo prefix may ever be deleted. */
  prefix: string
  list: (prefix: string) => Promise<{ asset_id: string; path: string }[]>
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

const drainStorageLedger = async (
  convex: CleanupConvex,
  storage: CleanupStorage,
  batchSize: number,
) => {
  const report = { deleted: 0, alreadyDeleted: 0, failed: 0, skippedOutsidePrefix: 0 }
  const attempted = new Set<string>()
  for (;;) {
    const pending = (await convex.pendingStorageDeletions({ limit: batchSize })).filter(
      (entry) => !attempted.has(`${entry.workspace}:${entry.assetId}`),
    )
    if (pending.length === 0) return report
    for (const entry of pending) {
      attempted.add(`${entry.workspace}:${entry.assetId}`)
      const reference = { workspace: entry.workspace, assetId: entry.assetId }
      // Never delete bytes this deployment's demo did not write, even if a row names them.
      if (
        entry.workspace !== storage.workspace ||
        entry.paths.some((path) => !path.startsWith(storage.prefix))
      ) {
        await convex.completeStorageDeletion(reference)
        report.skippedOutsidePrefix += 1
        continue
      }
      try {
        await storage.delete(entry.assetId)
        report.deleted += 1
      } catch (error) {
        if (!isNotFound(error)) {
          await convex.failStorageDeletion({ ...reference, error: errorText(error) })
          report.failed += 1
          continue
        }
        report.alreadyDeleted += 1
      }
      await convex.completeStorageDeletion(reference)
    }
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
  const storageObjects = storage ? await storage.list(storage.prefix) : []
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
            prefix: storage.prefix,
            objects: storageObjects.length,
            wouldHide: reset ? summary.visibleStoredAssets : summary.expiredStoredAssets,
          }
        : 'disabled',
      r2: r2 ? { objects: r2Keys.length } : reset ? 'disabled' : 'unchanged',
    }
  }

  // 1. Hide first: expired photos leave the gallery and delivery before any bytes are deleted.
  let hidden = 0
  for (;;) {
    const batch = await convex.requestStorageDeletion({ createdBefore, limit: batchSize })
    hidden += batch.requested.length
    if (!batch.hasMore) break
  }

  // 2. Delete Storage assets, then their references. Failures stay hidden and retryable.
  const ledger = storage
    ? await drainStorageLedger(convex, storage, batchSize)
    : { deleted: 0, alreadyDeleted: 0, failed: 0, skippedOutsidePrefix: 0 }

  // 3. A reset also removes this deployment's unregistered uploads, such as failed Assemblies.
  let orphans = 0
  if (reset && storage) {
    for (const object of await storage.list(storage.prefix)) {
      try {
        await storage.delete(object.asset_id)
        orphans += 1
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
  }

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
    if (ledger.failed === 0) purged = await convex.purgeAlbum()
  }

  return {
    dryRun: false,
    mode: reset ? 'reset' : 'expire',
    createdBefore,
    storage: storage ? { hidden, ...ledger, orphans } : 'disabled',
    r2: reset ? (r2 ? { deleted: r2Deleted } : 'disabled') : 'unchanged',
    convex: purged,
    retryNeeded: ledger.failed > 0,
  }
}
