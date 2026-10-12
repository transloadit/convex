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
- [x] `yarn check`: 242 tests, TypeScript and lint pass.
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
- [ ] Long-video grant renewal — reauthorize expired delivery grants without losing playback position.
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

### Native route follow-up, 12 October

[API2 #9766](https://github.com/transloadit/api2/pull/9766) repairs the identified origin framing
defect: URL Transform copied Content-Length for 206 responses, but dropped it on complete 200s.
Direct signed origin requests already returned correct ranges; the CDN's complete cached response
had no length. The fix preserves full/partial unencoded lengths, requests identity encoding and
avoids forwarding a compressed length alongside an automatically decoded body.

Controlled live comparison with the same 236,325-byte synthetic Storage video and only that header
changed: the warm control returned 200/all bytes; the corrected variant returned 206/1,024 bytes
with correct Content-Range. Real Chromium seeking stayed at 0 seconds for the control and reached
the requested 1 second for the corrected variant. Four temporary signature-required Templates
were deleted and the single prefix-bound test asset soft-deleted afterward. Existing Templates,
customer media and CDN configuration were unchanged.

This is an isolated cause-verification experiment, **not a production API2 deployment or a passing
Convex cloud test**. Keep this PR draft until #9766 is deployed and the existing real-media test
passes through the standard Built-in. Do not add a consumer Template/header workaround.

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

The final Opus follow-up found no additional release blocker in the application changes. Its
portrait-card finding has a failing-then-passing regression: playback dimensions now take
precedence over the original's unrotated dimensions. The first test batch lacked published video
rendition receipts before that fix; it was retained during testing and included in the prefix-bound
cleanup above. A missing-preview card in those earlier screenshots is not proof of a failed join
for a post-fix upload.

The grouped-media follow-up replaces receipt filtering with indexed original pagination and named
rendition lookups in `@transloadit/convex`. Direct originals and legacy `images_filtered` photos
share one ordered stream; posters and encodes no longer consume gallery pages. The browser's
automatic empty-page skipping is removed. The app still enforces live guest access and binds every
returned original/rendition to a server-owned upload path. An app-authorized page can still be empty
after that filtering. The initial-loading empty state, poster letterboxing and simple missing-preview
text remain unchanged; no player or upload-state abstraction was added.
Transloadit's literal `${file.*}` placeholders intentionally remain strings, despite lint warnings.

PR #44's first CI run passed package/example builds, both lint jobs, Node 24/26 unit tests, codegen
and local browser tests. The cloud job stopped on `fetch failed` / `ECONNRESET` before the media
checks; that is separate from, and does not explain, the locally reproduced real-CDN Range failure.
The branch-scoped Vercel preview is ready; neither result is production acceptance.

The grouped-media follow-up adds `listStoredMedia`, its typed client method/validators, and two
indexes over existing receipt fields; no row migration or ingestion change is needed. Existing asset
queries remain unchanged. No R2 migration/deletion, production
deployment or Template creation has been performed by this implementation. The owned isolated
Convex preview is `valiant-gopher-939` (`storage-media`), tested via local Next.js. A saved Template is
optional; the inline recipe works by default. Old public links remain public. Already-issued CDN
grants keep their bounded lifetime after logout; new route requests reauthorize.

Local evidence: `/tmp/convex-storage-review-WH7DDZkA/` (toy browser and real delivery results),
`/tmp/convex-storage-cloud-e2e-complete.log` (failing live test), and
`/tmp/convex-storage-check.log` (checks). These are evidence, not instructions required to resume.
The real-wedding backup/restore and retention requirements remain in
[wedding-gallery.md](wedding-gallery.md).

## Grouped-media follow-up (`media-items`)

This separate change adds the reusable query and removes the demo's Assembly scan and automatic
rendition-only page skipping. It does not change delivery, upload admission, retention, or production
configuration. A minor Changeset includes the new typed API; its two indexes use existing fields.

Local checks cover original-first pagination, interleaved legacy originals, large Assemblies,
missing/ambiguous/cross-scope renditions, tombstones, live inserts and loaded-range page splits.
Authorization tests exercise the actual app query/handler with `convex-test`, including anonymous,
expired and revoked guests and rendition paths outside the authorized upload prefix. Official
component codegen ran against a throwaway loopback backend without changing any `.env` file.
The desktop/mobile toy browser fixture checks the actual UI, not a live backend or CDN.
Final `yarn check` passes all 263 tests, TypeScript and lint; `yarn example:build` also passes.
The focused API/handler/UI set and 1440/390 px toy fixture pass without browser console or network
failures. Local fixture/browser processes were stopped after collecting the evidence.

The local Opus security review found no authorization regression. Council found no new grouped-query
blocker; its two delivery findings belong to the still-draft parent: the confirmed Range/seek defect
above, and long videos potentially reusing redirected CDN grants after expiry. The latter needs
position-preserving renewal through the authorized route and dedicated browser coverage before
parent activation; neither increasing the grant lifetime blindly nor toy playback proves a fix.
The grouped query has bounded producer/role fanout and a 100-item page / 200-original reactive read
cap, not a guarantee about arbitrary caller-side work. Album/time cursor boundaries intentionally
remain compatible with the existing asset query; callers keep producer configuration server-owned.

API2 CI run `38284436613` passed both changed Range/HTTP boundary suites, but failed five other
suites: two File Library Credentials contract/fixture failures and three YouTube daily-upload-limit
failures. The API2 fix is still undeployed; no retry or production release was performed here.
