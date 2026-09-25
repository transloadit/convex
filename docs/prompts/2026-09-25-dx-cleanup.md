# 2026-09-25 DX cleanup (PR #33)

Living notes for the Convex half of the approved DX cleanup. The SDK half (Viewer
`placeholder="blur"`, Zod storage results) is node-sdk #518 and its release PR #519.

## Checklist

- [x] Filtered empty pages keep "Show more memories" when later pages may hold photos (75cc40d).
- [x] Upload ThumbHashes paint an opaque thumbnail's blur, with an explicit `objectFit` per surface
      (a160daf; Viewer and Zod packs from SDK head e521c00 in 48c2e49).
- [x] Cursor-pagination wording, `storedAssets` in the data model, honest tombstone retention and
      the Convex peer floor in the README, CONTRIBUTING and changesets (d02e6f9).
- [x] Official component codegen with a CI drift check against a local backend (c78a784).
- [x] convex-helpers `paginator` plus its `usePaginatedQuery` replace the handmade window (3904b70).
- [ ] council-review, local browser evidence (desktop, phone, empty page, ThumbHash), claude-usertest,
      `yarn check`, push, CI green on the exact head.
- [ ] After the SDK packages are on npm: replace the `file:` Viewer and Zod packs with exact registry
      versions and drop the vendored packs and their overrides. Keep the release guard and the Yarn
      age gate (narrow, exact exceptions only).
- [ ] Merge only on Kevin's decision: a merge to `main` deploys the production demo.

## Privacy boundary

- Receipts are private metadata, never URLs or credentials. `makeTransloaditAPI` exposes no receipt
  queries; the example's `media:list` requires an admitted guest and binds every receipt to the
  server-created upload that reserved its Storage prefix.
- A ThumbHash is preview pixels. `media:list` and `media:forDelivery` return it only for versions
  that allow a preview (image geometry); original-only versions lose it. The media route authorizes
  every image request separately.
- Tombstones keep the receipt without its ThumbHash, its Assembly provenance and its album, user and
  upload linkage. Nothing purges them.

## Pagination substitution

Measured against 06a0041, excluding `yarn.lock` and `_generated`:

| | added | removed | net |
| --- | --- | --- | --- |
| Runtime and config | 154 | 277 | -123 |
| Tests | 226 | 94 | +132 |

Minified (gzip) bundles grew: the client pagination hook from 1086 (602) to 3644 (1445) bytes, the
server `lib.ts` from 24868 (6319) to 40903 (10690) bytes.

Guard parity with the handmade window:

- Cursors are the paginator's index keys. Earlier `[time, _creationTime]` tuples, garbage and other
  albums' keys are refused as `InvalidCursor` for both `cursor` and `endCursor`, which restarts
  `usePaginatedQuery`; the deletion ledger's album-less keys stay distinct from album keys.
- `numItems` is clamped to 1..500 and `maximumRowsRead` to numItems+1..1000; clients cannot raise
  either.
- Ties, the 1200-row album, stable loaded ranges during live inserts and deletes, and the split of a
  1055-row loaded page are covered by tests. The expiry scan's mid-page continuation is unchanged.
- Other query failures reach an error boundary that replaces the album with an alert instead of
  showing stale photos.

Scope beyond the swap itself: the `convex-helpers` runtime dependency, the `convex` peer floor,
`tsconfig.node.json` (keeps `erasableSyntaxOnly` for native-Node scripts only), the `keepLoadedRange`
repair and the load-failure boundary.

The `convex` peer floor is `^1.43.0` because the tested convex-helpers release (0.1.124) declares it.
A consumer pinned to `convex@1.43.0` and `convex-helpers@0.1.124` typechecks the component and passes
its 67 tests. `keepLoadedRange` works around that release's split behavior; see "Storage pagination"
in CONTRIBUTING.md.
