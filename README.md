# Transloadit Convex Component

A Convex component for creating Transloadit Assemblies, tracking their status/results, and supporting resumable tus uploads.

## Features

- Create Assemblies with templates or inline steps.
- Resumable uploads via tus (client-side hook; form uploads are intentionally not supported).
- Webhook ingestion with signature verification.
- Persist Assembly status + results in Convex.
- Typed API wrappers and React hooks.

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

The script reads `TRANSLOADIT_KEY/TRANSLOADIT_SECRET` from `.env`,
creates or updates the template `convex-demo`, and prints the template id.
Use that id as `VITE_TRANSLOADIT_TEMPLATE_ID` in `example/.env` when running the demo app.

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

## Webhook route

Transloadit sends webhooks as `multipart/form-data` with `transloadit` (JSON) and `signature` fields.

```ts
// convex/http.ts
import { httpAction, httpRouter } from "convex/server";
import { parseTransloaditWebhook } from "@transloadit/convex";
import { api } from "./_generated/api";

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

If you want to queue webhook processing (durable retry via Convex scheduling), use `queueWebhook`
and return HTTP 202:

```ts
await ctx.runAction(api.transloadit.queueWebhook, {
  payload,
  rawBody,
  signature,
});

return new Response(null, { status: 202 });
```

### Local testing and QA

Local webhook testing and browser tests are documented in `CONTRIBUTING.md`.

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

Note: Transloadit expects tus metadata `fieldname`. The hook sets it to `file` by default; override via `fieldName` or `metadata.fieldname`.
You can also use `onAssemblyCreated` to access the assembly id before the upload finishes.

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

See `example/README.md` for setup and usage.
