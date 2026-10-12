# Finish private media PRs #44/#45: video grant renewal

Handed off on 12 October 2026 from the root API2/Convex Storage session to studio1 `convex`,
which now owns both draft PRs. API2 #9766 (native Range framing) stays with root. No merge,
production deployment, new Storage/customer uploads or CDN changes are authorized here.

## Open items from PR context, CI and reviews

- [x] Council P2 (media-query round): later seeks/resumes reuse the redirected CDN grant after its
      150–300 s validity and fail. Fix through the same authorized route, keep position and
      playing state, no infinite retries, no public fallback, no TTL increase/proxy/player.
  - Viewer 0.0.5 has no video component; its route already answers every request with a fresh,
    `private, no-store` 307, so reloading the element's stable `src` reauthorizes. No upstream
    package change is needed.
  - Red: `Gallery.test.tsx` renewal/denial tests failed (`load` never called) before the fix.
    Synthetic Chromium probe before the fix: expired grant → CDN 403 → `MediaError` 2, route never
    re-hit, playing video left paused.
  - Green: `example/lib/media-grant.ts`, wired as the video's `ref`. Chromium probe after the fix:
    paused and playing seeks renew once and keep state; a revoked guest gets one route 404 and
    stays failed; a CDN that keeps refusing after renewal is not retried.
- [ ] Council P1 / PR #44 cloud QA: native CDN Range/seek. Blocked on API2 #9766 being deployed and
      the unchanged `E2E_EXPECT_STORAGE=1` cloud test passing. Not waived.
- [x] PR #45 needs the parent fix merged in, keeping the grouped-query work intact.
- [x] Claim lines moved to this session; PR descriptions keep the native CDN boundary explicit.
- [x] Council round 1 (parent): P1 native Range blocker kept. P2 valid: originals are stored
      straight from `:original`, so non-media uploads were listed and signed for inline delivery;
      red/green test, now refused by the shared binding check. P3 (auto-advance counts raw rows)
      left with a comment: only geometry-less photos remain, and #45 removes this skipping.
- [x] Local Opus UX and security reviews of the playback path: both PASS. Fixed red/green: a
      refused renewal no longer leaves a pending position restore. Comment/doc nits fixed;
      remaining UX limitations recorded in `docs/storage-media-review.md`.
- [ ] Further council rounds until only rejected/unrelated findings remain.
- [ ] CI on both branches; reviewer request only when a PR is truthfully ready.
