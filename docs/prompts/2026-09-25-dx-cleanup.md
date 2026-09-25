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
- [x] council-review on 1b4f248 found two issues, and the lead found a NaN page-limit bypass. Each
      was reproduced red first and fixed (9875d8a, 801538a, 83a6490). The codegen drift check now
      gates the production deploy (23072ce).
- [x] Local browser evidence (desktop, phone, empty first page, empty album, load failure,
      ThumbHash) and a first-time-guest user test; see "Gallery evidence".
- [ ] Exact-head CI: reported on PR #33, since this file is part of that head.
- [ ] Merge only on Kevin's decision: a merge to `main` deploys the production demo.

## SDK release

Observed on 2026-09-25 (UTC). This record replaces the SDK's pre-release finish checklist, which is
now a historical snapshot.

- node-sdk #518 merged as dc7d42d at 15:52:43Z. Release PR #519 (head 9b663aa) merged as 5b2b550 at
  16:02:37Z; CI run 36158197286 on 5b2b550 passed.
- Published: `@transloadit/viewer` 0.0.3 under the `alpha` tag (`latest` stays 0.0.1; its GitHub
  release is a prerelease); `@transloadit/node`, `@transloadit/types`, `@transloadit/zod` and
  `transloadit` 5.0.1; `@transloadit/mcp-server` 0.4.1. `@transloadit/utils` is unchanged at 4.9.0.
- Transient boundary: npm accepted Viewer 0.0.3 at 16:04Z, but its metadata stayed 404, so
  Changesets immediately retried the same version and got a 409 staged-version conflict. Nobody
  bumped a version or bypassed the workflow. Once the registry showed the packages (Viewer 0.0.3
  published 16:05:23Z, Zod 5.0.1 16:06:26Z), the same Release run was rerun: run 36158197469,
  attempt 2, succeeded at 16:11:06Z, and every package has its release tag.
  The race is documented in #519; this PR carries no workaround for it.
- The SDK lead verified a clean consumer that installs from the registry only
  (`/tmp/viewer-release-consumer.RdsATZ`): five tests pass (React blur, live auth with an exact
  download, both parsers, Node recovery) with neither Next nor Sharp installed.

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

The lead accepted this tradeoff. The later non-finite-limit guard (9875d8a) adds 8 runtime and 31
test lines, making it -115 and +163.

Guard parity with the handmade window:

- Cursors are the paginator's index keys. Earlier `[time, _creationTime]` tuples, garbage and other
  albums' keys are refused as `InvalidCursor` for both `cursor` and `endCursor`, which restarts
  `usePaginatedQuery`; the deletion ledger's album-less keys stay distinct from album keys.
- `numItems` is clamped to 1..500 and `maximumRowsRead` to numItems+1..1000; clients cannot raise
  either.
- Non-finite limits are refused on both list paths. NaN passes `Math.min` and `Math.max`; with an end
  cursor the helper then had no read limit, and one query returned all 1055 rows. Guests reach
  these limits through `media:list`. The expiry scan needs no guard: Convex's `take()` rejects NaN.
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

## Review fixes

- `--skip-storage` and `--skip-r2` only relaxed the missing-configuration error. With both backends
  configured, a reset with both flags still hid receipts, deleted Storage and R2 objects and purged
  results. A skip flag now leaves a configured backend untouched (801538a).
- The client's `listStoredAssetDeletions` required an album, although the component and the other
  ledger calls accept an omitted one (83a6490).
- The gallery's load-failure alert, new in this PR, used the muted grey (4.28:1 at 13px). It now uses
  the existing error colour (7.20:1, 2c262eb).
- `deploy-example` now needs the codegen drift job too; nothing else in CI changed (23072ce).

## Gallery evidence

`/tmp/convex-gallery-harness-20260925` renders the example's real `StorageGallery` with Viewer
0.0.3 against an in-page fake of `media:list`. Its fixture photos are local and their ThumbHashes are
real. It uses no deployment, Storage or credentials. Chromium was headless at 1280×800 and at
390×844 (touch). Vite ran on 127.0.0.1:5199, first as PID 2559720 and then as 2726061 for the
recapture after 2c262eb; both were stopped. There are 16 screenshots, plus `evidence.json`.

- Opaque photos with a ThumbHash paint the blur behind a cover-fitted thumbnail. There is no blur
  without a hash or for a transparent PNG. The viewer uses `contain` and returns focus after Escape.
- Paging goes from 24 to 30, and then the button goes away. After the first extra page the queries
  pin the loaded range with `endCursor`. Media requests use `preview:avif`.
- An empty filtered first page keeps "Show more memories", which then loads 6 photos. The empty
  album shows its invitation. The load failure shows its alert. There is no horizontal overflow and
  no page error.

The user test was one read-only first-time guest working from the screenshots. It had no P0. Its
findings, as reconciled with the lead:

- The empty-first scenario shows the gallery without its page chrome on purpose. A working "Show
  more" button and no false empty-album message is the approved behavior, not a pending redesign.
- "24 memories & counting" is the loaded count, not a promised total; no exact-count query.
- Follow-ups outside this PR: the muted captions and count line keep the pre-existing 4.28:1
  contrast, and the failure alert says "Some photos" even when none loaded. Other follow-ups are
  tiles that stay grey until the bytes arrive, raw file names in the viewer, no end-of-album cue, and
  videos mentioned but not in this harness.
