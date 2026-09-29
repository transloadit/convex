---
'@transloadit/convex': minor
---

`listAlbumResults` serves an album page in one component call. `createdAfter` skips results
persisted before a cutoff in the new `by_album_and_createdAt` index (it replaces `by_album`, which
Convex backfills on deploy), and `assemblyFields` joins the named keys of each result's Assembly
`fields`, so apps no longer call `getAssemblyStatus` once per Assembly to credit contributors. The
limit is clamped to 1–500 and non-finite limits or cutoffs are refused. `AlbumResultResponse` and
`vAlbumResultResponse` describe the joined rows. The component and client import the Assembly
status and URL helpers from `@transloadit/zod/v3` subpaths instead of the barrel, so functions no
longer bundle and evaluate every Robot schema.
