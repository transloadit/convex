---
'@transloadit/convex': minor
---

Register Transloadit Storage receipts from completed Assemblies. With a configured Storage Workspace
(`storageWorkspace`, or `TRANSLOADIT_WORKSPACE`), verified webhooks and refreshes store each
canonical receipt once per Workspace, asset and version, with its Assembly provenance. A malformed or
cross-Workspace receipt fails the whole status update. New queries read visible receipts per album
(paginated) or one exact version, and a deletion ledger hides assets before Storage deletion and
keeps them retryable until deletion is confirmed. Receipts are private metadata: expose them only
through application queries that authorize the viewer.
