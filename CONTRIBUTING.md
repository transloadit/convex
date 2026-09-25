# Contributing

Thanks for improving `@transloadit/convex`! Please keep changes focused and run checks before sending
them out.

## Development

Use Node.js 24.15+ or 26+ and the Yarn version pinned in `package.json`:

```bash
npm install --global corepack@0.36.0
corepack enable
yarn install --immutable
```

```bash
yarn check
```

This runs format, lint, module and example typechecks, and unit tests. For the full verification suite:

```bash
yarn verify
```

## Example app (local)

The `example/` app is a Next.js wedding gallery powered by Uppy + Convex.

```bash
export TRANSLOADIT_KEY=...
export TRANSLOADIT_SECRET=...
export TRANSLOADIT_R2_CREDENTIALS=...

# Keep this running in another terminal (cloudflared is downloaded if needed).
yarn tunnel --port 3000
# Set TRANSLOADIT_NOTIFY_URL to the printed notifyUrl
export TRANSLOADIT_NOTIFY_URL=...

yarn example:dev
```

Node 26 does not bundle Corepack. The bootstrap above installs it explicitly on both supported
Node versions. Keep the tunnel running for uploads; `--once` prints a URL and stops the tunnel.

If you want the API routes to talk to an existing Convex deployment (bypassing Convex Auth), set:

```bash
export CONVEX_URL=...
export CONVEX_ADMIN_KEY=...
```

The example exposes `POST /transloadit/webhook` and forwards webhooks into Convex via
`queueWebhook`. Realtime “new upload” toasts use a Convex subscription on recent assemblies. The
demo also applies a simple per-user upload limit in the Convex backend (see
`example/convex/wedding.ts`).

## Storage (required R2 persistence)

The example uses the `/cloudflare/store` robot to write processed files into Cloudflare R2.
Configure one of these:

```bash
# Option A: Transloadit template credentials (recommended)
export TRANSLOADIT_R2_CREDENTIALS=...

# Option B: supply R2 details directly
export R2_BUCKET=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ACCOUNT_ID=...   # or R2_HOST
export R2_PUBLIC_URL=...   # optional public URL prefix
```

The UI hides older items based on `NEXT_PUBLIC_GALLERY_RETENTION_HOURS` (default: 24) to discourage
spam/abuse. The demo bucket auto-expires objects after 1 day via an R2 lifecycle rule (reapply with
`yarn r2:lifecycle` or override with `R2_RETENTION_DAYS`). If you set `WEDDING_UPLOAD_CODE` on the
Convex deployment, guests must enter the code and a name before viewing or uploading. Without a
code, entering a name is sufficient. Set the variable in your local environment for local development.
Changing the code invalidates existing album access; guests must enter the new code to continue.
Cloud browser tests accept `E2E_WEDDING_UPLOAD_CODE` when testing a code-protected preview.

Raw `R2_*` credentials are a local QA convenience: inline signed Assembly instructions are sent to
the browser. For any guest-facing deployment, use named Transloadit Template credentials and omit
raw storage keys. The diagnostic panel is redacted, but redaction does not hide the instructions
Uppy must send. Album queries require a guest session, but existing R2 links remain public to anyone
who has them. Search engines receive `noindex` on every page; this is separate from access control.

The [wedding archive recommendation](docs/wedding-gallery.md) lists the separate storage, originals,
privacy, moderation, and backup work required before importing real wedding media.

## Demo deployment (Vercel + stable Convex)

For a public demo, deploy the `example/` app and point it at a stable Convex deployment.

1. Deploy a Convex app that includes this component (stable/prod deployment).
2. Set Vercel environment variables for the project:
   - `NEXT_PUBLIC_CONVEX_URL` (point to the stable Convex deployment)
   - `NEXT_PUBLIC_GALLERY_RETENTION_HOURS` (optional)
3. Set Convex environment variables on the deployment:
   - `TRANSLOADIT_KEY` and `TRANSLOADIT_SECRET`
   - `TRANSLOADIT_NOTIFY_URL` (set to `https://<deployment>.convex.site/transloadit/webhook`)
   - R2 credentials (see above)
   - `WEDDING_UPLOAD_CODE` (optional invitation code for viewing and uploading)
4. Trigger the Vercel deploy hook (or deploy manually).

To deploy a stable Convex backend for the demo (once per environment), run:

```bash
export CONVEX_DEPLOY_KEY=...
export TRANSLOADIT_KEY=...
export TRANSLOADIT_SECRET=...

yarn deploy:cloud
```

Use the printed deployment URL (e.g. `https://<deployment>.convex.cloud`) as the stable Convex URL:
- GitHub Actions secret: `E2E_REMOTE_CONVEX_URL`
- Vercel env var: `NEXT_PUBLIC_CONVEX_URL`

The stable demo URL is the Vercel production URL (e.g. `https://convex-demo.transload.it`) and
should be stored in the GitHub Actions secret `E2E_REMOTE_APP_URL`.

## Branch previews

Convex assigns a host such as `https://loyal-trout-380.convex.cloud`; a Git branch name is not a
Convex hostname. After CI first deploys a branch backend, use its printed `Deployment URL` for a
Vercel `NEXT_PUBLIC_CONVEX_URL` variable scoped to that preview branch, then redeploy the frontend:

```bash
vercel env add NEXT_PUBLIC_CONVEX_URL preview --git-branch <branch> --project convex --scope transloadit-com
```

Subsequent CI runs reuse the named Convex preview and preserve its URL. A hosted app with no
configured backend shows an unavailable state instead of leaving guest sign-in pending forever.
Cloud browser QA opens the ordinary preview URL without a `convexUrl` override and checks that
it connects to the deployment created by CI. Configure the branch variable before that check can
pass for a new branch.

## Demo Storage activation and rollback

Photos can use private Transloadit Storage; videos still use public R2. This demo is not a private
video album. Use the published Viewer alpha and SDK versions pinned in `package.json`.

Before enabling uploads, configure `TRANSLOADIT_SMART_CDN_KEY`, `TRANSLOADIT_SMART_CDN_SECRET` and
`TRANSLOADIT_SMART_CDN_WORKSPACE` on the matching Vercel environment. They must belong to the same
Workspace as the backend Assembly key; the delivery key needs `smart_cdn:sign`. Never expose them
with a `NEXT_PUBLIC_` name. The branch's `NEXT_PUBLIC_CONVEX_URL` must point to its own backend.

GitHub repository variables control activation independently:

- `TRANSLOADIT_STORAGE_PREVIEW_BRANCH` and `TRANSLOADIT_STORAGE_PREVIEW_WORKSPACE` opt in exactly
  one preview branch. Other previews keep the R2 path, even when production uses Storage.
- `TRANSLOADIT_WORKSPACE` opts production into Storage. Set it only after the isolated preview
  passes, then deploy the current main workflow. It never enables a preview implicitly.
- `TRANSLOADIT_STORAGE_UPLOADS_DISABLED=1` rolls production **new uploads** back to R2 on the next
  deployment. Keep the Workspace and delivery keys configured so existing private photos and
  in-flight upload receipts remain usable. Clear this switch to re-enable Storage uploads.

An explicitly empty Workspace value is applied to the backend, not silently skipped; clearing it
also disables existing private delivery. It is not the normal upload rollback. Local deploys which
omit the variable altogether leave its current value untouched.

Cloud QA sets `E2E_EXPECT_STORAGE=1` for an enabled environment. It requires same-origin authorized
photo URLs, byte-identical original downloads, anonymous denial and denial after logout. An R2-only
success must not be treated as Storage evidence. Video playback stays covered separately.

## Demo cleanup (Convex + Storage + R2)

The demo hides photos after 24 hours. `Expire demo Storage photos` runs daily on main, first reports
the selection, then expires Storage photos older than 24 hours. Physical removal can therefore take
up to another daily interval, plus retry delays. Failed deletions remain in the retry ledger.
The job shares the production-deploy concurrency group, has a 15-minute timeout and refuses any
backend whose prefix is not exactly `convex-demo/little-aardvark-87/wedding-gallery/`.

For an isolated deployment, inspect its exact prefix, then preview expiry:

```bash
yarn demo:cleanup --older-than=24 --expected-prefix=convex-demo/YOUR-DEPLOYMENT/wedding-gallery/ --dry-run
```

Remove `--dry-run` only after checking the target. This requires `CONVEX_URL`, `CONVEX_ADMIN_KEY`,
`TRANSLOADIT_WORKSPACE`, `TRANSLOADIT_KEY` and `TRANSLOADIT_SECRET`. The scheduled job reuses the
existing production deployment key as the admin key. Manual workflow dispatch defaults to dry-run.
Each deletion checks both the historical receipt path and current asset path. R2 is untouched by
expiry; its existing one-day lifecycle handles video objects separately.

**Without `--older-than`, `demo:cleanup` resets the whole album**, including R2. Use that only for
an intentional reset with the R2 credentials too, or an explicit `--skip-r2` / `--skip-storage`
choice. Missing backend credentials never authorize forgetting its still-live media references.
`DEMO_ALBUM` defaults to `wedding-gallery`.

## Verification and QA

Fast checks:

```bash
yarn check
```

This runs format, lint, typecheck, and unit tests. For a full verification run:

```bash
yarn verify
```

Additional commands:

- `yarn lint` (Biome)
- `yarn format` (Biome write)
- `yarn typecheck` (tsc)
- `yarn test` (Vitest unit tests)
- `yarn verify:local` (runs the Next.js wedding example + uploads an image + video)
- `yarn verify:cloud` (runs the browser flow against a deployed Next.js app)
- `yarn deploy:cloud` (deploys a stable Convex backend for the demo app)
- `yarn build` (tsc build + emit package json)

Notes:
- `yarn tunnel` is a support tool, not verification.
- CI should run non-mutating checks; local `yarn check` may format/fix.
- `yarn verify:local` needs `TRANSLOADIT_KEY`, `TRANSLOADIT_SECRET`, `TRANSLOADIT_NOTIFY_URL`, and R2
  credentials.
- `yarn verify:cloud` needs `E2E_REMOTE_APP_URL`.
- Set `TRANSLOADIT_DEBUG=1` to enable verbose verify logs.
- Local upload verification fails explicitly if Transloadit credentials are missing.
- The browser flow also checks decoded photos, video metadata, native view transitions, keyboard
  navigation, focus restoration, and phone-sized reduced-motion viewing. Set `E2E_SCREENSHOT_DIR`
  to a local directory to retain gallery/viewer screenshots.
- macOS tunnel bootstrap extracts the official cloudflared archive automatically.
- Cloud QA deploys the checked-in `example/convex` sources against the packed module and uses the
  root dependency versions; it no longer maintains a separate generated implementation.

## Component test helpers

For `convex-test`, you can use the built-in helper:

```ts
import { createTransloaditTest } from "@transloadit/convex/test";

const t = createTransloaditTest();
```

## Generated files

`src/component/_generated` is Convex codegen output. It is checked in so tests and component
consumers have stable API references. If you change component functions or schemas, regenerate it
with the official Convex CLI and commit the result:

```bash
CONVEX_AGENT_MODE=anonymous npx convex init   # once: a throwaway local backend, no account needed
yarn codegen                                  # convex codegen --component-dir ./src/component
```

Codegen analyses the component on a deployment without changing the code it runs. The root
`convex.json` points the CLI at the example app, which mounts the component from `src/`.
`yarn codegen` ignores `CONVEX_DEPLOY_KEY` so a key in `.env` never becomes the codegen target; it
uses the deployment `convex init` or `convex dev` configured. CI repeats these steps against a
local backend and fails when the committed output drifts.

## Storage pagination

`listStoredAssets` and `listStoredAssetDeletions` page with convex-helpers' `paginator`. The tested
helper release is 0.1.124, whose `convex` peer (`^1.43.0`) sets this package's peer floor; raise
the floor with the helper, not with whatever Convex happens to be installed.

One behavior of that release needs a local repair. When a loaded page (`endCursor` set) has grown
past `maximumRowsRead`, the paginator answers `SplitRequired` with `continueCursor` at the row where
it stopped reading, not at `endCursor`. `usePaginatedQuery` would then split the page into halves
that end there and silently drop the rest of the loaded range. `keepLoadedRange` in
`src/component/lib.ts` restores the page's end. The test "a frozen page that outgrows the read limit
splits without skipping a row" fails without it; keep both until an upgraded helper passes that test
with the repair removed.

## Releases (Changesets)

Releases are managed via Changesets and GitHub Actions. The package stays on 0.x while we iterate,
so breaking changes are allowed but must be described in the changeset.

1. Create a changeset:

```bash
yarn changeset
```

2. Commit and push it to `main`.
3. The Changesets workflow will open a “Version Packages” PR.
4. Merge that PR to publish to npm and tag the release.
