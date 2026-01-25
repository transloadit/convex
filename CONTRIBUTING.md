# Contributing

Thanks for improving `@transloadit/convex`! Please keep changes focused and run checks before sending
them out.

## Development

```bash
yarn check
```

This runs format, lint, typecheck, and unit tests. For the full verification suite:

```bash
yarn verify
```

## Example app (local)

The `example/` app is a Next.js wedding gallery powered by Uppy + Convex.

```bash
export TRANSLOADIT_KEY=...
export TRANSLOADIT_SECRET=...
export TRANSLOADIT_R2_CREDENTIALS=...

# Get a public webhook URL (cloudflared is auto-downloaded if needed)
yarn tunnel --once
# Set TRANSLOADIT_NOTIFY_URL to the printed notifyUrl
export TRANSLOADIT_NOTIFY_URL=...

yarn example:dev
```

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
Convex deployment, guests must enter the passcode before uploads can start.

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
   - `WEDDING_UPLOAD_CODE` (optional passcode for uploads)
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

## Demo cleanup (Convex + R2)

To remove demo uploads from Convex and Cloudflare R2, run:

```bash
yarn demo:cleanup
```

This requires:

- `CONVEX_URL`
- `CONVEX_ADMIN_KEY`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID` or `R2_HOST`

Optional:

- `DEMO_ALBUM` (defaults to `wedding-gallery`)
- `--dry-run` (prints the counts without deleting)

Note: the demo bucket is configured to auto-expire objects after 1 day via `yarn r2:lifecycle`.

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

## Component test helpers

For `convex-test`, you can use the built-in helper:

```ts
import { createTransloaditTest } from "@transloadit/convex/test";

const t = createTransloaditTest();
```

## Generated files

`src/component/_generated` is Convex codegen output. It is checked in so tests and component
consumers have stable API references. If you change component functions or schemas, regenerate with
Convex codegen (for example via `npx convex dev` or `npx convex codegen`) and commit the updated
files.

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
