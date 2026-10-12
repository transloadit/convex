# Private media dogfooding

Implementation branch: `storage-media`, 12 October 2026. This is not a production deployment record.

Why: the hosted demo already used private Storage for photos, but videos/posters still used public
R2 and video originals were not retained. New uploads now use one Storage pipeline and one Viewer
delivery route. Native browser video playback needs no new player abstraction.

- [x] Store direct originals, MP4 playback and posters; no public fallback.
- [x] Reuse the published Viewer URL helpers and server route; preserve guest/album/version checks.
- [x] Join derivatives by verified upload/source identity, never filename.
- [x] Optional processing Template; literal signed Storage paths remain server-owned.
- [x] Preserve legacy R2 viewing/cleanup and isolate the old local upload harness.
- [x] `yarn check`: 241 tests, TypeScript and lint pass.
- [x] `yarn example:build` passes. Hosted preview pause/admission/logout browser test passes;
  the preview's pause switch was restored afterward.
- [x] Actual isolated uploads produce private originals, MP4s and posters; photos and video originals
  download byte-identically. Anonymous requests and requests after logout return 404 for all three
  video URLs. Playback starts. No R2 credentials were supplied to the preview deployment.
- [x] Local 1440/390 px browser fixture, 94 focused handler/component tests and Opus UX/security review.
- [x] Council findings reconciled with failing-then-passing regressions: producer receipt names,
  rendition visibility, legacy Template naming, sparse pages, upload pause and repeated lookups.
- [x] Prefix-bound preview cleanup: dry run identified 13 visible receipts and 15 objects; reset
  hid the receipts, soft-deleted all 15 synthetic objects (including two initially unregistered
  renditions), and purged their three Assemblies. Zero failures/outside-prefix objects, no R2 calls.
- [ ] Live CDN Range/seek acceptance — **release blocker**, not a skipped test.
- [ ] CI and production activation.

## Blocking live finding

The real-media browser test reaches the private video, but `Range: bytes=0-1023` receives HTTP 200
with the complete 467,502-byte rendition and no `Content-Range`, instead of a 1,024-byte HTTP 206.
The same behavior reproduced directly against the signed Built-in URL, bypassing Next.js, on an
original as well as the rendition. The returned server identifies Bunny; this does not establish
whether the cause is in the CDN configuration or its origin. Even an out-of-bounds range returned
the whole original. Initial browser seeking did not advance; playback could start afterward.

The integration test remains red. Its Range assertions are soft only so the same run can collect
other failures; they still fail the test. No consumer byte proxy, alternate public path, CDN
configuration change or weakened acceptance criterion was introduced. Fix and verify the native
Storage/Smart CDN delivery path before merging this slice. Replay the existing cloud test afterward.

## Review reconciliation

Real Assemblies publish Storage receipts under the **producing** Step: `:original`, `video_encode`
and `video_poster`, not the store Step names. `result: false` on a producer suppresses its receipts
even when the store reports results. Tests now use these actual shapes; existing `images_filtered`
photos remain readable. Cleanup also recognizes legacy R2 producing Step names, preventing reset
from forgetting those references without R2 cleanup. No filename-based rendition join is used.

The toy browser fixture now asserts the rendition's actual URL and focus restoration after both
Escape and Close. Its passing seek check is **not** substituted for the failing real-CDN check.
Desktop Chrome at mobile width is not iOS Safari coverage; expired long-running video grants and
portrait/HDR footage remain unverified.

No component schema or published package API changes. No R2 migration/deletion, production
deployment or Template creation has been performed by this implementation. The owned isolated
Convex preview is `valiant-gopher-939` (`storage-media`), tested via local Next.js. A saved Template is
optional; the inline recipe works by default. Old public links remain public. Already-issued CDN
grants keep their bounded lifetime after logout; new route requests reauthorize.

Local evidence: `/tmp/convex-storage-review-WH7DDZkA/` (toy browser and real delivery results),
`/tmp/convex-storage-cloud-e2e-complete.log` (failing live test), and
`/tmp/convex-storage-check.log` (checks). These are evidence, not instructions required to resume.
The real-wedding backup/restore and retention requirements remain in
[wedding-gallery.md](wedding-gallery.md).
