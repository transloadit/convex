# @transloadit/convex

## 0.4.0

### Minor Changes

- 48248a6: `listAlbumResults` serves an album page in one component call. `createdAfter` skips results
  persisted before a cutoff in the new `by_album_and_createdAt` index (it replaces `by_album`, which
  Convex backfills on deploy), `stepNames` keeps only the named Steps' results among the newest
  `limit` rows, and `assemblyFields` joins the named keys of each remaining result's Assembly
  `fields`, so apps no longer call `getAssemblyStatus` once per Assembly to credit contributors.
  Steps are filtered before the join, so the Assemblies of dropped results are not read. The join
  reads Assemblies in batches that fit the calling query's remaining read limit, so large
  Assemblies end the page early with the newest rows that fit instead of failing the query. Each
  row repeats its Assembly's fields, so a page also ends before it would pass the separate 16 MiB
  return limit.
  The limit is clamped to 1–500 and non-finite limits or cutoffs are refused. `AlbumResultResponse`
  and `vAlbumResultResponse` describe the joined rows. The `makeTransloaditAPI` wrapper accepts
  `createdAfter` and `stepNames` but not `assemblyFields`, so exporting it does not let callers
  read Assembly `fields`. The component and client import the Assembly status and URL helpers from
  `@transloadit/zod/v3` subpaths instead of the barrel, so functions no longer bundle and evaluate
  every Robot schema.

## 0.3.0

### Minor Changes

- 6775ac9: Require `convex` 1.43 or newer (previously 1.24.8). Storage receipt pages use convex-helpers'
  `paginator`, and the tested convex-helpers release (0.1.124) declares a `^1.43.0` Convex peer.
  Upgrade `convex` before upgrading this package.
- e416c77: Allow trusted server callers to require matching Assembly fields when refreshing status, before
  persisting fetched results. This supports album and uploader access checks in applications.
- 6775ac9: Register Transloadit Storage receipts from completed Assemblies. With a configured Storage Workspace
  (`storageWorkspace`, or `TRANSLOADIT_WORKSPACE`), verified webhooks and refreshes store each
  canonical receipt once per Workspace, asset and version, with its Assembly provenance. A malformed or
  cross-Workspace receipt fails the whole status update. `listStoredAssets` pages an album's visible
  receipts newest first with Convex cursors (use `usePaginatedQuery` from `convex-helpers/react`), and
  `getStoredAsset` reads one exact version. A deletion ledger hides assets before Storage deletion,
  keeps them retryable until deletion is confirmed, and then leaves tombstones so late notifications
  cannot register deleted assets again. Tombstones keep the receipt without its ThumbHash, its Assembly
  provenance and its album and user linkage; nothing purges them. Receipts and ThumbHashes are private
  metadata: expose them only through application queries that authorize the viewer.

## 0.2.1

### Patch Changes

- Align client metadata fields with the backend's object validator and refresh generated Convex bindings.
  This preserves typechecking after deploying the example or regenerating component types.

## 0.2.0

### Minor Changes

- 3dcadd2: Refresh dependencies and support Node.js 24.15+ and 26+. Consolidate webhook verification so only
  the signed body is persisted, and preserve an explicit trusted verification opt-out in queued jobs.

  Modernize the wedding example with Motion photo viewing, persistent export selection, shared upload
  helpers, and a single backend source for deployment QA. Expand example typechecking and browser
  verification, and repair the macOS webhook tunnel bootstrap.

## 0.1.0

### Minor Changes

- e14fee2: - switch the example and docs to Uppy + @uppy/transloadit and remove the React/tus helpers
  - add signed assemblyOptions helpers and ensure expected upload counts are included in params
  - update docs for the new Uppy-first integration path

## 0.0.6

### Patch Changes

- a8389a0: Docs: clarify results table stores one row per output file per step.

## 0.0.5

### Patch Changes

- Add demo retention tooling and document R2 lifecycle expiry.

## 0.0.4

### Patch Changes

- b45892d: chore: validate changesets release flow
