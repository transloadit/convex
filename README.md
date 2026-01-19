# Transloadit Convex Component

A Convex component for creating Transloadit Assemblies, handling resumable uploads with tus, and persisting status/results in Convex.

## Features

- Create Assemblies with templates or inline steps.
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

### 3) (Optional) Create a demo template (idempotent)

We use the Transloadit CLI under the hood for the best DX and to avoid hand-rolling API calls.

```bash
yarn template:ensure
```

The script reads `TRANSLOADIT_KEY/TRANSLOADIT_SECRET` from `.env`, creates or updates the template `convex-demo`, and prints the template id. The wedding example uses inline steps, so a template is optional.

## Flow overview

1. A Convex action creates the Assembly (secret stays server-side).
2. The client uploads via tus using `tus_url` + `assembly_ssl_url`.
3. Transloadit posts a signed webhook; we `queueWebhook` to persist results.
4. The UI queries results/status and renders the gallery.

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

Note: if you don’t supply `expires`, the component defaults it to 1 hour from now.

## Data model

The component stores Transloadit metadata in two tables:

```
assemblies 1 ──── * results
```

- `assemblies`: one row per Transloadit Assembly (status/ok, notify URL, uploads, raw payload, etc).
- `results`: one row per output file, keyed by `assemblyId` + `stepName` with the raw result payload.

Lifecycle:
1. `createAssembly` inserts the initial `assemblies` row.
2. `handleWebhook`, `queueWebhook`, or `refreshAssembly` upserts the assembly + replaces results.
3. `listResults` returns flattened step outputs for use in UIs.

## Webhook route

Transloadit sends webhooks as `multipart/form-data` with `transloadit` (JSON) and `signature` fields.

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { parseTransloaditWebhook } from "@transloadit/convex";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { payload, rawBody, signature } =
      await parseTransloaditWebhook(request);

    await ctx.runAction(api.transloadit.handleWebhook, {
      payload,
      rawBody,
      signature,
    });

    return new Response(null, { status: 204 });
  }),
});

export default http;
```

If you want to queue webhook processing (durable retry via Convex scheduling), use `queueWebhook` and return HTTP 202:

```ts
await ctx.runAction(api.transloadit.queueWebhook, {
  payload,
  rawBody,
  signature,
});

return new Response(null, { status: 202 });
```

## Client wrapper

If you prefer a class-based API (similar to other Convex components), use `Transloadit`:

```ts
import { Transloadit } from "@transloadit/convex";
import { components } from "./_generated/api";

const transloadit = new Transloadit(components.transloadit, {
  authKey: process.env.TRANSLOADIT_KEY!,
  authSecret: process.env.TRANSLOADIT_SECRET!,
});
```

## React usage

### Resumable tus upload

```tsx
import { useTransloaditTusUpload } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

function TusUpload() {
  const { upload, isUploading, progress } = useTransloaditTusUpload(
    api.transloadit.createAssembly,
  );

  const handleUpload = async (file: File) => {
    await upload(file, {
      templateId: "template_id_here",
      onAssemblyCreated: (assembly) => console.log(assembly.assemblyId),
    });
  };

  return (
    <div>
      <input type="file" onChange={(e) => handleUpload(e.target.files![0])} />
      {isUploading && <p>Uploading: {progress}%</p>}
    </div>
  );
}
```

Note: Transloadit expects tus metadata `fieldname`. The hook sets it to `file` by default; override via `fieldName` or `metadata.fieldname`. You can also use `onAssemblyCreated` to access the assembly id before the upload finishes.

### Reactive status/results

```tsx
import { useAssemblyStatus, useTransloaditFiles } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

function AssemblyStatus({ assemblyId }: { assemblyId: string }) {
  const status = useAssemblyStatus(api.transloadit.getAssemblyStatus, assemblyId);
  const results = useTransloaditFiles(api.transloadit.listResults, {
    assemblyId,
  });

  if (!status) return null;
  return (
    <div>
      <p>Status: {status.ok}</p>
      <p>Results: {results?.length ?? 0}</p>
    </div>
  );
}
```

### Polling fallback (no webhooks)

```tsx
import { useAssemblyStatusWithPolling } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

const status = useAssemblyStatusWithPolling(
  api.transloadit.getAssemblyStatus,
  api.transloadit.refreshAssembly,
  assemblyId,
  { pollIntervalMs: 5000, stopOnTerminal: true },
);
```

## Example app (Next.js + Uppy wedding gallery)

The `example/` app is a wedding gallery where guests upload photos + short videos. It uses Uppy on the client and a Next API route that talks to Convex. If you do not set `CONVEX_URL`/`CONVEX_ADMIN_KEY`, the example uses the in-process Convex test harness.
Uploads in this demo use Transloadit hosted storage (temporary, ~24 hours). Preview deployments reset the gallery on each deploy; add a storage robot (S3/GCS/etc.) to persist files.

Quick start (local):

```bash
# In repo root
export TRANSLOADIT_KEY=...
export TRANSLOADIT_SECRET=...

# Get a public webhook URL (cloudflared is auto-downloaded if needed)
yarn tunnel --once
# Set TRANSLOADIT_NOTIFY_URL to the printed notifyUrl
export TRANSLOADIT_NOTIFY_URL=...

yarn example:dev
```

If you want the API routes to talk to an existing Convex deployment, set:

```bash
export CONVEX_URL=...
export CONVEX_ADMIN_KEY=...
```

The example exposes `POST /transloadit/webhook` and forwards webhooks into Convex via `queueWebhook`.

### Deploy the example (Vercel + stable Convex)

For a public demo, deploy the `example/` app and point it at a stable Convex deployment.

1. Deploy a Convex app that includes this component (stable/prod deployment).
2. Set Vercel environment variables for the project:
   - `CONVEX_URL` and `CONVEX_ADMIN_KEY` (point to the stable Convex deployment)
   - `TRANSLOADIT_KEY` and `TRANSLOADIT_SECRET`
   - `TRANSLOADIT_NOTIFY_URL` (set to `https://<deployment>.convex.site/transloadit/webhook`)
3. Trigger the Vercel deploy hook (or deploy manually).

Once deployed, use the Vercel URL as `E2E_REMOTE_APP_URL` for `yarn verify:cloud`.

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
- `yarn verify:cloud` (runs the browser flow against a deployed Next.js app + Convex cloud backend)
- `yarn build` (tsc build + emit package json)

Notes:
- `yarn template:ensure` and `yarn tunnel` are support tools, not verification.
- CI should run non-mutating checks; local `yarn check` may format/fix.
- `yarn verify:local` needs `TRANSLOADIT_KEY` and `TRANSLOADIT_SECRET`.
- `yarn verify:cloud` needs `E2E_REMOTE_APP_URL`, `CONVEX_URL`, and `CONVEX_ADMIN_KEY`.

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

3. Update `package.json` version and commit it:

```bash
git checkout main
git pull
# edit package.json version, then:
git add package.json
git commit -m "Release vX.Y.Z"
git push
```

4. Tag and push the release:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. The `Publish to npm` workflow will:
   - build and pack a `.tgz` artifact,
   - create a draft GitHub release,
   - publish the tarball to npm with provenance.

## Roadmap (condensed)

- Completed: tus-only uploads, webhook handling, polling fallback, typed API wrappers, React hooks, browser QA.
- Possible next steps: richer typed step/result validators, automated webhook retries with backoff, additional templates/recipes.

## References

- Convex components authoring guide
- Convex official components (e.g. Resend, Aggregate)
- Transloadit API docs (assembly status + resumable uploads)
