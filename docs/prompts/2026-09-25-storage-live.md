# Activate the published Storage photo path in the wedding demo

Kevin approved implementation, isolated preview proof, production activation, and squash/admin
merge after green review/checks on September 25, 2026. Video stays public R2. Uppy File Library
work is not in scope.

## Checkout and baseline

- Owned checkout: framework1 `/home/kvz/code/convex`, branch `storage-live`, from main `f188ea9`.
  The previous owner explicitly handed over the clean checkout.
- Published `@transloadit/convex` 0.3.0, Viewer 0.0.3 alpha, Zod 5.0.1. Upgrade the demo/admin
  development dependency to published Node 5.0.1 (narrow exact-version quarantine exemption).
- Production Convex: `little-aardvark-87`; album `wedding-gallery`; expected prefix
  `convex-demo/little-aardvark-87/wedding-gallery/`.
- Before this change, one repository variable enabled both production and all previews, empty
  variables did not clear persisted settings, and Storage had no daily expiry schedule.

## Evidence checklist

- [x] Red-first: wrong expected namespace previously deleted media; now rejected before list/write.
- [x] Red-first: upload rollback previously kept signing Storage uploads. New-upload R2 rollback
      now leaves existing private receipts accessible and their Workspace configured.
- [x] Explicit empty settings clear persisted activation/rollback; omitted local settings remain.
- [x] Focused suites and `yarn check`: 188 tests and type checks pass.
- [x] Council: no issues. Local-only Opus security review: PASS; 32 route probes plus Chromium
      and WebKit image/download/revocation evidence with published Viewer 0.0.3. A nonblocking
      secret-scope finding was fixed red-first: installation steps cannot access cleanup keys.
- [x] Isolated branch backend `necessary-kingfisher-139` and branch-only Vercel delivery credentials
      configured, then Storage activated. Production remains off until the merge gate passes.
- [x] Real preview uncovered two existing private-image regressions, fixed red-first: the original
      download link stole initial dialog focus, and `display: contents` removed the picture's
      native view-transition box. Close-button focus and image slide transitions are restored.
- [ ] Exact-head preview: decoded photos, byte-identical download, anonymous/logout denial, video,
      desktop/mobile screenshots, expiration selection and owned synthetic-media cleanup.
- [ ] PR checks green, squash/admin merge, main build/deploy green.
- [ ] Production delivery keys configured before setting the backend Workspace switch; verify
      actual Storage upload and signed delivery, not only legacy R2 browser success.
- [ ] Daily cleanup dry-run verified against the production namespace; scheduled expiry enabled.

## Safety and next steps

Credentials are not written into the repo or evidence. Existing `.env` files are read-only. Use the
permanent approved Smart CDN key from `.env.production.local`, through protected tool stdin/API only.
Do not reset a production album; expiry is always `--older-than=24` with an exact prefix check.
Keep the Community filtered-original limitation documented until API2 #9253 is deployed and the
Community byte-identity canary passes. A merged API2 fix alone is not sufficient evidence.

Update this document with exact PR/head/deployment receipts as the work progresses.
