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
- [x] After the SDK packages reached npm: exact registry versions replace the `file:` Viewer and Zod
      packs, and the vendored packs and their overrides are gone. The release guard and the Yarn age
      gate stay, with exact exceptions only (73fe6e7).
- [ ] council-review, local browser evidence (desktop, phone, empty page, ThumbHash), claude-usertest,
      `yarn check`, push, CI green on the exact head.
- [ ] Merge only on Kevin's decision: a merge to `main` deploys the production demo.

## SDK release

Observed on 2026-09-25 (UTC). This record replaces the SDK's pre-release finish checklist, which is
now a historical snapshot.

- node-sdk #518 merged as dc7d42d at 15:52:43Z. Release PR #519 (head 9b663aa) merged as 5b2b550 at
  16:02:37Z; CI on 5b2b550 passed.
- Published: `@transloadit/viewer` 0.0.3 under the `alpha` tag (`latest` stays 0.0.1);
  `@transloadit/node`, `@transloadit/types`, `@transloadit/zod` and `transloadit` 5.0.1;
  `@transloadit/mcp-server` 0.4.1. `@transloadit/utils` is unchanged at 4.9.0.
- Transient boundary: npm accepted Viewer 0.0.3 at 16:04Z, but its metadata stayed 404, so
  Changesets immediately retried the same version and got a 409 staged-version conflict. Nobody
  bumped a version or bypassed the workflow. Once the registry showed the packages (Viewer 0.0.3
  published 16:05:23Z, Zod 5.0.1 16:06:26Z), the same Release run was rerun: run 36158197469,
  attempt 2, succeeded at 16:11:06Z, and every package has its release tag.

## Registry dependencies

73fe6e7 pins `@transloadit/zod` 5.0.1 (runtime dependency) and `@transloadit/viewer` 0.0.3 (dev
dependency for the example) exactly. It removes `vendor/sdk-preview`, its resolutions, the QA
template's `file:` overrides and the tarball Git attributes. `@transloadit/utils` `^4.8.1` resolves
to 4.9.0 for this package, Viewer and `@transloadit/node` alike.

The registry tarballs carry the same runtime JavaScript as the vendored e521c00 packs; Zod's
`.d.ts` files differ only in member order. `.yarnrc.yml` admits exactly `@transloadit/viewer@0.0.3`
and `@transloadit/zod@5.0.1` before the 24-hour age gate, which still applies to everything else.
`scripts/assert-publishable.ts` still runs before Changesets and passes on this manifest.

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
