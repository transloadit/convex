# Transloadit Convex Component

A Convex component for creating Transloadit Assemblies, handling resumable uploads with tus, and persisting status/results in Convex.

## Features

- Create Assemblies with Templates or inline Steps.
- Resumable uploads via tus (client-side hook; form/XHR uploads are intentionally not supported).
- Webhook ingestion with signature verification (direct or queued).
- Persist Assembly status + results in Convex tables.
- Typed API wrappers and React hooks.

## Requirements

- Node.js 24+
- Yarn 4 (Corepack)

## Install

```bash
yarn add @transloadit/convex
```

## Setup

### 1) Register the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import transloadit from "@transloadit/convex/convex.config";

const app = defineApp();
app.use(transloadit);

export default app;
```

### 2) Set environment variables

```bash
npx convex env set TRANSLOADIT_KEY <your_auth_key>
npx convex env set TRANSLOADIT_SECRET <your_auth_secret>
```

## Golden path (secure by default)

1. **Server-only create**: a Convex action creates the Assembly (auth secret stays server-side).
2. **Client upload**: use `useTransloaditUppy` for resumable uploads.
3. **Webhook ingestion**: verify the signature and `queueWebhook` for durable processing.
4. **Realtime UI**: query status/results and render the gallery.

## Backend API

```ts
// convex/transloadit.ts
import { makeTransloaditAPI } from "@transloadit/convex";
import { components } from "./_generated/api";

export const {
  createAssembly,
  handleWebhook,
  queueWebhook,
  refreshAssembly,
  getAssemblyStatus,
  listAssemblies,
  listResults,
  storeAssemblyMetadata,
} = makeTransloaditAPI(components.transloadit);
```

Note: pass `expires` in `createAssembly` when you need a custom expiry; otherwise the component defaults to 1 hour from now.

## Data model

The component stores Transloadit metadata in two tables:

```
assemblies 1 ──── * results
```

- `assemblies`: one row per Transloadit Assembly (status/ok, notify URL, uploads, raw payload, etc).
- `results`: one row per output file, keyed by `assemblyId` + `stepName`, plus normalized fields (name/size/mime/url) and the raw Transloadit output object.

Lifecycle:
1. `createAssembly` inserts the initial `assemblies` row.
2. `handleWebhook`, `queueWebhook`, or `refreshAssembly` upserts the assembly + replaces results.
3. `listResults` returns flattened step outputs for use in UIs.

## Webhook route

Transloadit sends webhooks as `multipart/form-data` with `transloadit` (JSON) and `signature` fields.

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { handleWebhookRequest } from "@transloadit/convex";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleWebhookRequest(request, {
      mode: "queue",
      runAction: (args) => ctx.runAction(api.transloadit.queueWebhook, args),
    }),
  ),
});

export default http;
```

## Client wrapper (optional)

Most integrations should use `makeTransloaditAPI` (above). If you prefer a class-based API
(similar to other Convex components), use `Transloadit`:

```ts
import { Transloadit } from "@transloadit/convex";
import { components } from "./_generated/api";

const transloadit = new Transloadit(components.transloadit, {
  authKey: process.env.TRANSLOADIT_KEY!,
  authSecret: process.env.TRANSLOADIT_SECRET!,
});
```

## React usage (Uppy)

```tsx
import { useTransloaditUppy } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

const { startUpload, status, results, stage } = useTransloaditUppy({
  uppy,
  createAssembly: api.wedding.createWeddingAssembly,
  getStatus: api.transloadit.getAssemblyStatus,
  listResults: api.transloadit.listResults,
  refreshAssembly: api.transloadit.refreshAssembly,
});

await startUpload({
  createAssemblyArgs: { guestName, uploadCode },
});
```
For advanced/legacy helpers (raw parsing, low-level tus uploads, polling utilities), see `docs/advanced.md`.

## Example app (Next.js + Uppy wedding gallery)

The `example/` app is a wedding gallery where guests upload photos + short videos. It uses Uppy on the client and Convex Auth (anonymous sign-in) to create assemblies securely. If you do not set `NEXT_PUBLIC_CONVEX_URL`, the example falls back to the in-process Convex test harness.
Uploads are stored via Transloadit directly into Cloudflare R2.
The client wiring uses the `useTransloaditUppy` hook from `@transloadit/convex/react` to keep Uppy + polling in sync.

Quick start (local):

```bash
# In repo root
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

The example exposes `POST /transloadit/webhook` and forwards webhooks into Convex via `queueWebhook`.
Realtime “new upload” toasts use a Convex subscription on recent assemblies.
The demo also applies a simple per-user upload limit in the Convex backend (see `example/convex/wedding.ts`).

### Storage (required R2 persistence)

The example uses the `/cloudflare/store` robot to write processed files into Cloudflare R2. Configure one of these:

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

The UI hides older items based on `NEXT_PUBLIC_GALLERY_RETENTION_HOURS` (default: 24) to discourage spam/abuse.
If you set `WEDDING_UPLOAD_CODE` on the Convex deployment, guests must enter the passcode before uploads can start.

### Deploy the example (Vercel + stable Convex)

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

Once deployed, use the Vercel URL as `E2E_REMOTE_APP_URL` for `yarn verify:cloud`.
CI expects a stable Vercel production URL in the `E2E_REMOTE_APP_URL` secret on `main`.

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
- `yarn verify:local` needs `TRANSLOADIT_KEY`, `TRANSLOADIT_SECRET`, `TRANSLOADIT_NOTIFY_URL`, and R2 credentials.
- `yarn verify:cloud` needs `E2E_REMOTE_APP_URL`.
- Set `TRANSLOADIT_DEBUG=1` to enable verbose verify logs.

## Component test helpers

For `convex-test`, you can use the built-in helper:

```ts
import { createTransloaditTest } from "@transloadit/convex/test";

const t = createTransloaditTest();
```

## Generated files

`src/component/_generated` is Convex codegen output. It is checked in so tests and component consumers have stable API references. If you change component functions or schemas, regenerate with Convex codegen (for example via `npx convex dev` or `npx convex codegen`) and commit the updated files.

## Release process

Releases are automated via GitHub Actions and published to npm using OIDC (Trusted Publisher).

1. Ensure CI is green on `main`.
2. Run local checks:

```bash
yarn check
```

3. Add a changeset describing the release:

```bash
yarn changeset
```

4. Apply the changeset version bump and commit:

```bash
yarn changeset:version
git add package.json
git commit -m "Release vX.Y.Z"
git push
```

5. Tag and push the release:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

6. The `Publish to npm` workflow will:
   - build and pack a `.tgz` artifact,
   - create a draft GitHub release,
   - publish the tarball to npm with provenance.
