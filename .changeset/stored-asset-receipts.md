---
'@transloadit/convex': minor
---

Register Transloadit Storage receipts from completed Assemblies. With a configured Storage Workspace
(`storageWorkspace`, or `TRANSLOADIT_WORKSPACE`), verified webhooks and refreshes store each
canonical receipt once per Workspace, asset and version, with its Assembly provenance. A malformed or
cross-Workspace receipt fails the whole status update. `listStoredAssets` pages an album's visible
receipts newest first with Convex cursors (use `usePaginatedQuery` from `convex-helpers/react`), and
`getStoredAsset` reads one exact version. A deletion ledger hides assets before Storage deletion,
keeps them retryable until deletion is confirmed, and then leaves tombstones so late notifications
cannot register deleted assets again. Tombstones keep the receipt without its ThumbHash, its Assembly
provenance and its album and user linkage; nothing purges them. Receipts and ThumbHashes are private
metadata: expose them only through application queries that authorize the viewer.
