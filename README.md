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

### 3) Create a demo template (idempotent)

We use the Transloadit CLI under the hood for the best DX and to avoid hand-rolling API calls.

```bash
yarn template:ensure
```

The script reads `TRANSLOADIT_KEY/TRANSLOADIT_SECRET` from `.env`, creates or updates the template `convex-demo`, and prints the template id. Use that id as `VITE_TRANSLOADIT_TEMPLATE_ID` in `example/.env` when running the demo app.

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

## Example app

The `example/` directory contains a minimal Vite + React app wired to the component.

```bash
cd example
yarn install
npx convex dev
# In another terminal:
yarn dev
```

Set environment variables in Convex:

```bash
npx convex env set TRANSLOADIT_KEY <your_auth_key>
npx convex env set TRANSLOADIT_SECRET <your_auth_secret>
```

Create `example/.env` and set `VITE_TRANSLOADIT_TEMPLATE_ID` (use `yarn template:ensure` to create one). To test webhooks locally, run `yarn tunnel` and set `VITE_TRANSLOADIT_NOTIFY_URL` to the generated URL.

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
- `yarn verify:local` (browser + webhook QA flow against local Convex test harness)
- `yarn verify:example` (runs the same flow against the example app)
- `yarn verify:preview` (deploys a preview Convex app and runs the same browser flow against it)
- `yarn build` (tsc build + emit package json)

Notes:
- `yarn template:ensure` and `yarn tunnel` are support tools, not verification.
- CI should run non-mutating checks; local `yarn check` may format/fix.
- `yarn verify:preview` needs `CONVEX_DEPLOY_KEY`, `TRANSLOADIT_KEY`, and `TRANSLOADIT_SECRET`.

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
