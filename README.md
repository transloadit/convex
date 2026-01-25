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

The `example/` app is a wedding gallery where guests upload photos + short videos. It uses Uppy on
the client and Convex Auth (anonymous sign-in) to create assemblies securely. Uploads are stored via
Transloadit directly into Cloudflare R2.

Live demo: `https://convex-demo.transload.it`

For setup, deployment, and verification details, see `CONTRIBUTING.md`.
