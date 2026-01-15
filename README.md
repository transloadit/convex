# Transloadit Convex Component

A Convex component for creating Transloadit Assemblies, tracking their status/results, and supporting both form uploads and resumable tus uploads.

## Features

- Create Assemblies with templates or inline steps.
- Generate signed upload params for browser form uploads.
- Resumable uploads via tus (client-side hook).
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

Preferred names:

```bash
npx convex env set TRANSLOADIT_AUTH_KEY <your_auth_key>
npx convex env set TRANSLOADIT_AUTH_SECRET <your_auth_secret>
```

Aliases also supported:

```bash
npx convex env set TRANSLOADIT_KEY <your_auth_key>
npx convex env set TRANSLOADIT_SECRET <your_auth_secret>
```

### 3) Create a demo template (idempotent)

We use the Transloadit CLI under the hood for the best DX and to avoid hand-rolling API calls.

```bash
yarn template:ensure
```

The script reads `TRANSLOADIT_KEY/TRANSLOADIT_SECRET` (or `TRANSLOADIT_AUTH_KEY/TRANSLOADIT_AUTH_SECRET`) from `.env`,
creates or updates the template `convex-demo`, and prints the template id.
Use that id as `VITE_TRANSLOADIT_TEMPLATE_ID` in `example/.env` when running the demo app.

## Backend API

```ts
// convex/transloadit.ts
import { makeTransloaditAPI } from "@transloadit/convex";
import { components } from "./_generated/api";

export const {
  createAssembly,
  generateUploadParams,
  handleWebhook,
  getAssemblyStatus,
  listAssemblies,
  listResults,
  storeAssemblyMetadata,
} = makeTransloaditAPI(components.transloadit);
```

Note: if you don’t supply `expires`, the component defaults it to 1 hour from now.

## Webhook route

Transloadit sends webhooks as `multipart/form-data` with `transloadit` (JSON) and `signature` fields.

```ts
// convex/http.ts
import { httpAction, httpRouter } from "convex/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const formData = await request.formData();
    const rawPayload = formData.get("transloadit");
    const signature = formData.get("signature");

    if (typeof rawPayload !== "string") {
      return new Response("Missing payload", { status: 400 });
    }

    const payload = JSON.parse(rawPayload);

    await ctx.runAction(api.transloadit.handleWebhook, {
      payload,
      rawBody: rawPayload,
      signature: typeof signature === "string" ? signature : undefined,
    });

    return new Response(null, { status: 204 });
  }),
});

export default http;
```

### Local webhook testing with cloudflared

If you want to test webhooks locally, tunnel your Convex dev HTTP endpoint:

```bash
yarn tunnel
```

Use the generated public URL as `notifyUrl` when creating Assemblies or set
`VITE_TRANSLOADIT_NOTIFY_URL` for the example app.

You can also run `yarn tunnel --once` to print the URL and exit.

### Full QA flow (template + tunnel + webhook)

This runs an end-to-end webhook QA flow against Transloadit using a local webhook server
and cloudflared (auto-downloaded if missing):

```bash
yarn qa:full
```

It prints a JSON summary including the assembly id, webhook status, and number of stored results.

## React usage

### Form upload

```tsx
import { useTransloaditUpload } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

function UploadButton() {
  const { upload, isUploading, progress, error } = useTransloaditUpload(
    api.transloadit.generateUploadParams,
  );

  const handleUpload = async (file: File) => {
    await upload(file, {
      templateId: "template_id_here",
      onProgress: (percent) => console.log(percent),
    });
  };

  return (
    <div>
      <input type="file" onChange={(e) => handleUpload(e.target.files![0])} />
      {isUploading && <p>Uploading: {progress}%</p>}
      {error && <p>{error.message}</p>}
    </div>
  );
}
```

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

## Smoke test

Create a `.env` file in the repo root and run:

```bash
yarn smoke
```

Expected output: a JSON blob containing `assemblyId` and (when available) `tusUrl`.

## Example app

See `example/README.md` for setup and usage.
