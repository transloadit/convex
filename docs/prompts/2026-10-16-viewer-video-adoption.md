# Viewer video adoption

The wedding app should pass exact Storage receipts to the published Viewer, not maintain a
second grant-renewal state machine. The canonical DAM plan remains API2's
`docs/prompts/2026-10-15-handover-dam.md`; this is only this PR's validation checklist.

- [x] Replace app-level video URLs/ref recovery with the optional `Video` component and delete
  `example/lib/media-grant.ts`. Keep original downloads, admission and missing-preview behavior.
- [x] Make the lazy-uploader test wait for its locale effect. The previous main CI failure was
  an assertion racing that effect; production deployment was skipped, not accepted.
- [x] Pin registry-published Viewer 0.0.8 in both manifests and the lockfile. Update the existing
  exact-version age-gate exception; no broad quarantine exemption. Publication:
  [SDK release run](https://github.com/transloadit/node-sdk/actions/runs/38969024847).
- [x] Verify receipt mapping, original downloads, native controls and bounded renewal/refusal.
- [x] Reconcile council's pending-lockfile finding after publication. `yarn check` passes with
  282 tests, the production build passes, and all ten local Chromium browser tests pass.

Post-merge acceptance belongs in the canonical plan: confirm the normal production deployment,
collect fresh desktop/mobile evidence, then obtain and reconcile an independent Opus 5.5 review.
Keep live-browser observations separate from simulated range expiry and field performance.
