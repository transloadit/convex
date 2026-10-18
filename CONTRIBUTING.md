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

## Local development and browser tests

To learn the Storage upload-once/delivery flow without setting up Convex or Vercel, start with the
[SDK's runnable example](https://github.com/transloadit/node-sdk/tree/main/packages/node/examples/upload-once).
Its CLI owns login and local seeding; it does not configure this application's credentials or guest
access rules. The full wedding example below is for developing and testing the integration.

The wedding example has one backend: Convex Auth and private Transloadit Storage. Configure
`NEXT_PUBLIC_CONVEX_URL` and the server-only delivery credentials for your own deployment
as described below, then run `yarn example:dev`. Missing backend configuration displays an
unavailable state; there is no in-memory session API, direct R2 uploader, or public fallback.

`yarn verify:local` needs no cloud credentials. It runs the actual gallery components in a
test-only browser fixture with controlled image responses, covering URL navigation, slow images,
bounded preloading, keyboard/focus behavior and reduced motion. It does not certify uploads or
authorization. For those, use the isolated cloud preview and `yarn verify:cloud`.

The demo applies per-user upload limits in `example/convex/wedding.ts`. Set
`WEDDING_UPLOAD_CODE` on Convex to require an invitation code as well as a guest name.
Changing the code invalidates existing album access. Without a code, entering a name is sufficient.
Cloud tests accept `E2E_WEDDING_UPLOAD_CODE` for protected previews. Search indexing is disabled
separately; it is not access control.

The gallery displays the last `NEXT_PUBLIC_GALLERY_RETENTION_HOURS` (default 24), measured when
the album opens. Its fixed `createdAfter` bound is applied before pagination, so loading another
page does not spend it on hidden history or move the display cutoff. Reloading starts a new visit.
This is a display policy, not deletion or permission revocation. The Storage cleanup job below
performs deletion. Existing public R2 objects and their lifecycle configuration are untouched by
this code removal; old URLs cannot be made private retroactively.

## Demo deployment (Vercel + stable Convex)

The hosted wedding app is a Yarn workspace with an exact `@transloadit/convex@0.6.0` registry
dependency. It does not alias package imports to this repository's `src/`. Both `example:build` and
the production backend deploy check the resolved package before proceeding. Publish a component
release first, then update `example/package.json` and the lockfile to dogfood it on the live demo.
The workspace list includes `.` so Changesets continues to discover and release the root library;
the private example is never published.
Changesets only updates `workspace:` dependency ranges, keeping the demo's registry pin untouched
until that new version is actually available on npm.

Ordinary production and preview deployments preserve the deployment's existing JWT signing key
and matching public JWKS. They initialize auth only when both variables are absent; incomplete or
mismatched pairs stop the deploy instead of silently rotating keys and breaking existing guests.
An optional `JWT_PRIVATE_KEY` can seed a new deployment, but cannot replace an existing different
key. Key rotation is a separate operator task, not a side effect of deploying application code.
Initialization sends both variables together through stdin without `--force`; existing values and
CLI output are never printed. If a pair is incomplete, restore the matching pair from the approved
backup rather than clearing production auth to make a deploy pass. The auth check happens after
the Convex code deployment, so a refusal is not a claim that no deployment changes occurred.

Package unit tests and component codegen still exercise the repository source. Preview backend QA
installs a freshly packed candidate, so unpublished changes remain testable; its Vercel frontend
uses the example's released dependency.

For a public demo, deploy the `example/` app and point it at a stable Convex deployment.

1. Deploy a Convex app that includes this component (stable/prod deployment).
2. Set Vercel environment variables for the project:
   - `NEXT_PUBLIC_CONVEX_URL` (point to the stable Convex deployment)
   - `NEXT_PUBLIC_GALLERY_RETENTION_HOURS` (optional)
   - `TRANSLOADIT_SMART_CDN_KEY`, `TRANSLOADIT_SMART_CDN_SECRET`, `TRANSLOADIT_SMART_CDN_WORKSPACE`
     (server-only delivery credentials, with `smart_cdn:sign`)
3. Set Convex environment variables on the deployment:
   - `TRANSLOADIT_KEY` and `TRANSLOADIT_SECRET`
   - `TRANSLOADIT_NOTIFY_URL` (set to `https://<deployment>.convex.site/transloadit/webhook`)
   - `TRANSLOADIT_WORKSPACE` (the same Workspace as the Assembly and delivery keys)
   - `TRANSLOADIT_WEDDING_TEMPLATE_ID` (optional; see below)
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
Convex hostname. Vercel bakes `NEXT_PUBLIC_CONVEX_URL` into each build, so a new branch needs that
variable scoped to its preview once. CI's first `Convex deployment QA` run deploys the branch
backend, then its `Check preview backend` step fails and prints the exact command, with the URL
Convex assigned, in the log and job summary:

```bash
vercel env add NEXT_PUBLIC_CONVEX_URL preview --git-branch <branch> --value <deployment-url> --no-sensitive --force --project convex --scope transloadit-com
```

Run it with Vercel access, then push a new commit: the preview for the existing commit was built
without the variable. Later CI runs reuse the named Convex preview while it exists. Convex can
delete an older preview, though, and the next deploy then creates a new one with a different URL.
The same check then fails because the preview still talks to the old backend, and it prints the
command with the new URL. Run it again, since `--force` replaces the stale value, and push a new
commit. Browser QA never runs against the wrong deployment. A hosted app with no configured
backend shows an unavailable state instead of leaving guest sign-in pending forever. Cloud browser
QA opens the ordinary preview URL without a `convexUrl` override.

An opted-in Storage preview also needs its three server-only `TRANSLOADIT_SMART_CDN_*` delivery
variables scoped to that branch, as described below. A different branch's Secret variables are not
inherited, and Vercel does not reveal their values afterward. Configure them from the approved
secret store before testing; never copy secrets into commits or browser-visible configuration.
Without them, uploads can complete but the private media route correctly refuses delivery.

## Demo Storage activation and rollback

All new hosted media uses private Transloadit Storage: unchanged originals, MP4 playback and video
posters. Use the published Viewer alpha and SDK versions pinned in `package.json`. Existing public
R2 public links retain their external lifecycle; the demo no longer renders or manages those objects.
They are not migrated or made private by this code change.

Before enabling uploads, configure `TRANSLOADIT_SMART_CDN_KEY`, `TRANSLOADIT_SMART_CDN_SECRET` and
`TRANSLOADIT_SMART_CDN_WORKSPACE` on the matching Vercel environment. They must belong to the same
Workspace as the backend Assembly key; the delivery key needs `smart_cdn:sign`. Never expose them
with a `NEXT_PUBLIC_` name. The branch's `NEXT_PUBLIC_CONVEX_URL` must point to its own backend.

GitHub repository variables control activation independently:

- `TRANSLOADIT_STORAGE_PREVIEW_BRANCH` and `TRANSLOADIT_STORAGE_PREVIEW_WORKSPACE` opt in exactly
  one preview branch. Other previews still run cloud QA for admission, logout and an explicit
  upload-unavailable response. Production never implicitly enables a preview.
- `TRANSLOADIT_WORKSPACE` opts production into Storage. Set it only after the isolated preview
  passes, then deploy the current main workflow. The production deploy refuses a missing Workspace
  before changing the backend, including during an upload pause. It never enables a preview implicitly.
- `TRANSLOADIT_STORAGE_UPLOADS_DISABLED=1` pauses **new uploads** on the next deployment, without a
  public R2 fallback. Keep the Workspace and delivery keys so existing private media and in-flight
  receipts remain usable. Clear this switch to re-enable uploads.

An explicitly empty Workspace value is applied to the backend, not silently skipped; clearing it
also disables existing private delivery. It is not the normal upload rollback. Local deploys which
omit the variable altogether leave its current value untouched.

Cloud QA sets `E2E_EXPECT_STORAGE=1` for an enabled environment. It requires same-origin authorized
photo/video/poster URLs, byte-identical original downloads, byte-range video responses/seek,
anonymous denial and denial after logout. An R2-only success is not Storage evidence.
With `E2E_EXPECT_UPLOADS_DISABLED=1`, QA instead verifies admission and the intentional upload
refusal before logout; a deliberate production pause is not treated as a failed upload test.

### Optional reusable processing Template

The inline recipe works without creating a Template. To reuse it across consumers, with the
existing Assembly key/secret in your environment, run:

```bash
yarn template:ensure --wedding
```

This creates or updates `convex-wedding-media-v1` with `/upload/handle`, video filtering, encoding
and a poster. Set the returned ID as `TRANSLOADIT_WEDDING_TEMPLATE_ID` on Convex (or the GitHub
repository variable for CI deployment). Clearing it returns to the identical inline recipe.
The app still signs three literal, server-chosen Storage output paths per upload. Do not move those
paths into `${fields.*}` Template variables: multipart fields can override signed fields and are
not authorization. Receipts must also match the server-created upload record.

## Demo cleanup (Convex + Storage)

The demo hides media after 24 hours. `Expire demo Storage media` runs daily on main, first reports
the selection, then expires originals and derivatives older than 24 hours. Physical removal can therefore take
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
expiry; its existing one-day lifecycle handles legacy public objects separately.

**Without `--older-than`, `demo:cleanup` resets the Convex album and its Storage media.** Use that
only for an intentional reset. `--skip-storage` preserves the database references and reports an
incomplete reset. Missing credentials never authorize forgetting still-live media. No command in
this repository deletes legacy R2 objects, changes their lifecycle, or requires R2 credentials.
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
- `yarn verify:local` (deterministic browser gallery tests, no cloud credentials)
- `yarn verify:cloud` (runs the browser flow against a deployed Next.js app)
- `yarn deploy:cloud` (deploys a stable Convex backend for the demo app)
- `yarn build` (tsc build + emit package json)

Notes:
- CI should run non-mutating checks; local `yarn check` may format/fix.
- `yarn verify:cloud` needs `E2E_REMOTE_APP_URL`.
- Set `TRANSLOADIT_DEBUG=1` to enable verbose verify logs.
- The browser flow also checks decoded photos, video metadata, shared exact-version links, keyboard
  navigation, focus restoration, and phone-sized reduced-motion viewing. Set `E2E_SCREENSHOT_DIR`
  to a local directory to retain gallery/viewer screenshots.
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

`listStoredMedia` uses convex-helpers' `mergedStream` over indexed original producers, with the
same album/visibility/time cursor shape and loaded-range split handling. Renditions are joined by
exact indexed provenance, never a fixed-size Assembly scan. Its lower 100-item page / 200-original
read cap reserves room for up to four rendition roles. Test legacy/direct original interleaving,
deletion of a cursor anchor and live inserts with fixed `endCursor`s when changing these indexes.
`createdAfter` is an exclusive index bound, fixed for one pagination session, not a post-page
filter. `getStoredMedia` shares the producer validation and indexed rendition join, but intentionally
has no display cutoff: the app owns authorization for retained exact-version links.

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

2. Commit it on a branch and merge the reviewed PR into `main`.
3. The Changesets workflow will open a “Version Packages” PR.
4. Merge that PR to publish to npm and tag the release.

Yarn installs and builds the project. Changesets CLI 2 and its compatible Action 1 are pinned so
the release uses npm's trusted-publishing/OIDC and provenance support. Changesets 3 switches a
Yarn workspace to Yarn's publisher; do not upgrade it until that path passes publication with
provenance enabled. The 0.6.1 release hit a duplicate transparency-log entry in that path.
