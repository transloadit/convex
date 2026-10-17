---
'@transloadit/convex': minor
---

Add `getStoredMedia` for exact-version original and rendition lookup using the same bounded,
provenance-aware indexes as `listStoredMedia`. Applications no longer need to scan an Assembly's
results to resolve a shared video link; app authorization still applies to every receipt.

`listStoredMedia` now accepts an optional fixed `createdAfter` display cutoff, applied in the
original indexes before pagination so old hidden media does not consume gallery pages.
