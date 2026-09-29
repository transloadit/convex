---
'@transloadit/convex': minor
---

`listAlbumResults` serves an album page in one component call. `createdAfter` skips results
persisted before a cutoff in the new `by_album_and_createdAt` index (it replaces `by_album`, which
Convex backfills on deploy), `stepNames` keeps only the named Steps' results among the newest
`limit` rows, and `assemblyFields` joins the named keys of each remaining result's Assembly
`fields`, so apps no longer call `getAssemblyStatus` once per Assembly to credit contributors.
Steps are filtered before the join, so the Assemblies of dropped results are not read. The join
reads Assemblies in batches that fit the calling query's remaining read limit, so large
Assemblies end the page early with the newest rows that fit instead of failing the query. The
limit is clamped to 1–500 and non-finite limits or cutoffs are refused. `AlbumResultResponse` and
`vAlbumResultResponse` describe the joined rows. The `makeTransloaditAPI` wrapper accepts
`createdAfter` and `stepNames` but not `assemblyFields`, so exporting it does not let callers
read Assembly `fields`. The component and client import the Assembly status and URL helpers from
`@transloadit/zod/v3` subpaths instead of the barrel, so functions no longer bundle and evaluate
every Robot schema.
