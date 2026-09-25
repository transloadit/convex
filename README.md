# Transloadit Convex Component

A Convex component for creating Transloadit Assemblies, signing Uppy uploads, and persisting status/results in Convex.

## Features

- Create Assemblies with Templates or inline Steps.
- Signed upload options for Uppy + `@uppy/transloadit`.
- Webhook ingestion with signature verification (direct or queued).
- Persist Assembly status + results in Convex tables.
- Typed API wrappers and helpers.

## Requirements

- Node.js 24.15+ or 26+
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

## Upload flow

1. **Server-only create**: a Convex action creates signed `assemblyOptions` (auth secret stays server-side).
2. **Client upload**: use Uppy + `@uppy/transloadit` with `assemblyOptions()`.
3. **Webhook ingestion**: verify the signature and `queueWebhook` for durable processing.
4. **Realtime UI**: query status/results and render the gallery.

## Backend API

```ts
// convex/transloadit.ts
import { makeTransloaditAPI } from "@transloadit/convex";
import { components } from "./_generated/api";

export const {
  createAssembly,
  createAssemblyOptions,
  handleWebhook,
  queueWebhook,
  refreshAssembly,
  getAssemblyStatus,
  listAssemblies,
  listResults,
  storeAssemblyMetadata,
} = makeTransloaditAPI(components.transloadit);
```

These wrappers do not add application authorization. Expose only the operations your app needs,
and add membership/ownership checks for signing, queries, refresh, edits, and deletion. The example
limits guest signing to its wedding pipeline and keeps cleanup internal; album reads require an
admitted guest.

Note: pass `expires` in `createAssembly` when you need a custom expiry; otherwise the component defaults to 1 hour from now.

## Data model

The component stores Transloadit metadata in two tables:

```
assemblies 1 ──── * results
```

- `assemblies`: one row per Transloadit Assembly (status/ok, notify URL, uploads, raw payload, etc).
- `results`: one row per output file, grouped by `assemblyId` + `stepName` (a step can yield multiple rows). Each row includes normalized fields (name/size/mime/url), optional `resultId`, and the raw Transloadit output object.

Lifecycle:
1. `createAssembly` inserts the initial `assemblies` row.
2. `handleWebhook`, `queueWebhook`, or `refreshAssembly` upserts the assembly + replaces results.
3. `listResults` returns flattened step outputs for use in UIs.

## Storage receipts

When an Assembly writes to Transloadit Storage with the `/transloadit/store` Robot, the component
can keep each canonical receipt (`workspace`, `asset_id`, `version_id`, `path`,
`size`, `mime`, checksums, dimensions and optional ThumbHash). Enable it with the Storage Workspace:

```ts
const transloadit = new Transloadit(components.transloadit, { storageWorkspace: "my-workspace" });
// or set TRANSLOADIT_WORKSPACE for makeTransloaditAPI and the class defaults
```

- Only completed Assemblies register receipts, from verified webhooks or authoritative refreshes.
  A malformed or cross-Workspace receipt fails the whole status update; nothing is persisted.
- `storedAssets` keeps one row per Workspace, asset and version, with its Assembly, Step, result and
  original IDs, plus `album`, `userId` and `uploadId` copied from the signed Assembly fields.
  Notification retries are harmless.
- `listStoredAssets` returns a bounded, newest-first window of an album's visible receipts from
  local data (grow `limit` to show more; components cannot use `.paginate()`, and a window keeps
  reactive galleries gap-free); `getStoredAsset` returns one exact version. Neither contacts Storage
  or signs anything.
- Deletion is a ledger: `requestStoredAssetDeletion` hides every version of expired assets at once,
  your server deletes them from Storage, then `completeStoredAssetDeletion` turns the rows into
  tombstones (or `failStoredAssetDeletion` records a retryable error). A tombstone keeps only what
  stops a late notification from registering the deleted asset again; its ThumbHash is removed.

Byte-identical originals depend on the Assembly: on the Community plan, API2 currently exempts
only store Steps that use `:original` directly from its upload watermark, so a Step that stores a
filter of `:original` (as the wedding example does for photos) stores watermarked photos there.

Receipts are private metadata, not credentials. Signed Assembly fields are not ownership proof on
their own: bind receipts to server-created upload records and authorize every read, as the
example's `convex/media.ts` does. `makeTransloaditAPI` deliberately exposes no receipt queries.

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

## Uppy client (React example)

```tsx
import Uppy from "@uppy/core";
import Transloadit from "@uppy/transloadit";
import { api } from "../convex/_generated/api";

const uppy = new Uppy().use(Transloadit, {
  waitForEncoding: true,
  assemblyOptions: async () => {
    const { assemblyOptions } = await runAction(
      api.wedding.createWeddingAssemblyOptions,
      { fileCount, guestName, uploadCode },
    );
    return assemblyOptions;
  },
});

await uppy.upload();
```
Note: `assemblyOptions()` is called once per batch, so pass per-file metadata via Uppy file meta
(e.g. `uppy.setFileMeta(fileId, {...})`) and use `fields` for shared values.

Migration note: the `@transloadit/convex/react` entrypoint has been removed; use Uppy +
`@uppy/transloadit` directly.

For status parsing and polling helpers, see `docs/advanced.md`.

## Example app (Next.js + Uppy wedding gallery)

The `example/` app is a wedding gallery where guests upload photos + short videos. It uses Uppy on
the client and Convex Auth with a required guest name to enter the album. Uploads are stored via
Transloadit directly into Cloudflare R2.

Live demo: `https://convex-demo.transload.it`

For setup, deployment, and verification details, see `CONTRIBUTING.md`.

Customize the names, initials, optional date, and cover path in `example/lib/wedding.ts`.
The included cover is a compressed copy of the existing wedding photo fixture. The album keeps
photos in their original proportions and opens uploads in a dialog (a bottom sheet on phones),
so guests can keep browsing while their files upload.

Guests first enter their name and, when configured, the `WEDDING_UPLOAD_CODE` invitation code.
The server checks access for album reads and uploads; changing the code requires guests to sign in
again. The login name prefills the editable upload name, which is stored in signed Assembly fields
and shown beside photos and videos. A fully successful upload closes the dialog and shows the number
of files added. The entrance and album send `noindex` directives to search engines.

Without an invitation code, anyone can enter a name to access the album. Names are self-reported,
not verified identities. Existing R2 media URLs remain public to anyone who has the link; fully
private media requires private storage and authorized delivery too. The in-memory session API is
only available in local development; hosted albums use Convex Auth.
The globe menu switches between English, Dutch, Ukrainian, and German without discarding selected
files; the `NEXT_LOCALE` cookie remembers the choice. Like the content site, this uses `next-intl`
and ICU messages. Edit the complete catalogs in `example/messages/`; `yarn check` verifies their
keys and formatting. Uppy receives the same locale, with compatibility additions in
`example/i18n/uppy.ts`. Filenames, guest names, and wedding configuration remain user content.

Photo viewing uses Motion 13.4 `AnimateView` with React 19.3, a keyboard-accessible dialog, and a
reduced-motion path. See [the wedding archive recommendation](docs/wedding-gallery.md) before using
the disposable demo for real wedding media, including the proposed Storage/`@transloadit/img` integration.
