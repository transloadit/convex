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
- [x] First PR CI passed codegen, builds, lint, browser tests and Node 24/26 tests. Preview QA
  correctly refused a new branch without its public Convex URL. Configure only that branch's
  `NEXT_PUBLIC_CONVEX_URL` to its assigned backend and rebuild; no Storage opt-in or credentials
  change. The original failed QA receipt remains in run `38969602939`.

Post-merge acceptance belongs in the canonical plan: confirm the normal production deployment,
collect fresh desktop/mobile evidence, then obtain and reconcile an independent Opus 5.5 review.
Keep live-browser observations separate from simulated range expiry and field performance.

## Post-release favicon regression

- [x] Fresh live video QA traced the sole resource error to `/favicon.ico`, not private media.
      Serve the existing album icon at that native-media fallback path; no second icon design.
- [x] Add a route regression and check the actual endpoint in preview/production browser QA.
- [x] Council reports no issues; `yarn check` passes 283 tests and the production build passes.
- [x] First CI passed the code checks but correctly refused the new branch preview without its
      public backend URL. Bind only `video-icon` to its assigned `affable-lark-654` preview and
      rebuild. No secrets, production settings or Storage opt-in changed.
- [ ] Deploy through ordinary main CI before the final evidence pass.
