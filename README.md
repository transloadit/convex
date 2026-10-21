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
- `convex` 1.43+ (peer dependency). Storage receipt pages use convex-helpers' `paginator`, and the
  tested convex-helpers release (0.1.124) declares this Convex floor.

Development and GitHub automation use Node.js 26.12.1+ in the 26.x line (`nvm use`).
Node 26 does not bundle Corepack; install `corepack@0.36.0` and run `corepack enable`
before `yarn install --immutable`. CI retains Node 24 unit coverage for the public runtime floor.
The Vercel example stays on the provider-supported Node 24 runtime; Vercel currently supports
[Node 22 and 24](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) and manages
minor and patch updates. The package's public Node requirement above is unchanged.

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

### 2) Configure server-side credentials

```bash
npx convex env set TRANSLOADIT_KEY <your_auth_key>
npx convex env set TRANSLOADIT_SECRET <your_auth_secret>
```

Creating a client, registering functions and reading stored metadata do not require these
credentials. Assembly creation, upload signing and refresh require both when called; webhook
verification requires only the secret. Missing credentials fail the operation, not module loading
or codegen. Keep credentials on the Convex backend, never in browser code.

## Upload flow

1. **Authorize and sign**: your app action checks access, chooses the pipeline on the server, and creates signed `assemblyOptions`.
2. **Client upload**: use Uppy + `@uppy/transloadit` with `assemblyOptions()`.
3. **Webhook ingestion**: verify the signature and `queueWebhook` for durable processing.
4. **Realtime UI**: query status/results and render the gallery.

## Backend API: app-owned functions

```ts
// convex/transloaditClient.ts
import { Transloadit } from "@transloadit/convex";
import { components } from "./_generated/api";

export const transloadit = new Transloadit(components.transloadit);
```

This creates a server-side helper, **not public Convex endpoints**. Call its methods from your own
`action`, `query` or `mutation` after checking the caller's access. An authenticated caller is not
automatically allowed to access every album or Assembly. Keep pipeline, Template, Workspace,
ownership fields and Storage paths server-chosen; do not forward arbitrary browser signing inputs.

The runnable [wedding app](example/) is the reference integration, rather than a second copy of its
access rules here:

| Boundary | Existing app implementation |
| --- | --- |
| Upload signing | [`wedding.ts`](example/convex/wedding.ts): admitted guest, bounded batch, server-chosen recipe and upload record/path |
| Gallery and exact media | [`media.ts`](example/convex/media.ts): live admission, album and upload ownership, server-chosen rendition map |
| Assembly activity and refresh | [`transloadit.ts`](example/convex/transloadit.ts): album-wide activity summaries, owner-only status/results and expected owner fields on refresh |
| Webhooks and deletion | [`http.ts`](example/convex/http.ts), [`transloadit.ts`](example/convex/transloadit.ts) and [`storageCleanup.ts`](example/convex/storageCleanup.ts): verified ingestion and internal-only mutations |

`makeTransloaditAPI()` and `client.api()` remain compatible for existing integrations, but are
deprecated: they register public functions without app authorization. Do not re-export them as a
new app's backend. See [migration guidance](docs/advanced.md#legacy-public-wrappers).

Note: pass `expires` in `createAssembly` when you need a custom expiry; otherwise the component defaults to 1 hour from now.

## Data model

The component stores Transloadit metadata in three tables:

```
results * ──── 1 assemblies 1 ──── * storedAssets
```

- `assemblies`: one row per Transloadit Assembly (status/ok, notify URL, uploads, raw payload, etc).
- `results`: one row per output file, grouped by `assemblyId` + `stepName` (a step can yield multiple rows). Each row includes normalized fields (name/size/mime/url), optional `resultId`, and the raw Transloadit output object.
- `storedAssets`: one Storage receipt per Workspace, asset and version, with the Assembly, Step and
  result that stored it (see [Storage receipts](#storage-receipts)). Storage objects adopted for
  deletion have no Assembly.

Lifecycle:
1. `createAssembly` inserts the initial `assemblies` row.
2. `handleWebhook`, `queueWebhook`, or `refreshAssembly` upserts the assembly + replaces results.
3. `listResults` returns flattened step outputs for use in UIs.
4. `listAlbumResults` returns an album's newest results, at most 500, from the
   `by_album_and_createdAt` index. `createdAfter` skips older rows in that index, `stepNames`
   keeps only the named Steps' results among those rows, and `assemblyFields` joins the named
   keys of each remaining result's Assembly `fields` (such as a contributor's display name), so
   an album page needs one component call instead of one per Assembly. Non-finite limits or
   cutoffs are refused.
   The join reads each distinct Assembly document. Component calls share the calling query's
   16 MiB read limit, so when joining large Assemblies would exceed what remains, the page ends
   early with the newest rows that fit instead of failing. Pass `stepNames` so the Assemblies of
   results the page drops are not read. Reads the app query makes after the call share that
   limit too. Each row repeats its Assembly's fields, so the page also ends before the first row
   that would take the response past Convex's separate 16 MiB return limit. An empty
   `assemblyFields` reads nothing.
   The `makeTransloaditAPI` wrapper does not accept `assemblyFields`: join Assembly fields in an
   app query that authorizes the caller.

## Storage receipts

When an Assembly writes to Transloadit Storage with the `/transloadit/store` Robot, the component
can keep each canonical receipt (`workspace`, `asset_id`, `version_id`, `path`,
`size`, `mime`, checksums, dimensions and optional ThumbHash). Enable it with the Storage Workspace:

```ts
const transloadit = new Transloadit(components.transloadit, { storageWorkspace: "my-workspace" });
// or set TRANSLOADIT_WORKSPACE for the default
```

- Only completed Assemblies register receipts, from verified webhooks or authoritative refreshes.
  A malformed or cross-Workspace receipt fails the whole status update; nothing is persisted.
- `storedAssets` keeps one row per Workspace, asset and version, with its Assembly, Step, result and
  original IDs, plus `album`, `userId` and `uploadId` copied from the signed Assembly fields.
  Notification retries are harmless.
- `listStoredAssets` pages an album's visible receipts newest first, from local indexed data. It
  takes Convex `paginationOpts` and answers with Convex's cursor protocol, including `pageStatus`
  and `splitCursor` when a loaded page grows past the read limit, so an app query can pass pages
  through to `usePaginatedQuery` from `convex-helpers/react`, which keeps loaded pages gap-free
  while new photos arrive. A page holds at most 500 receipts and reads at most 1000 rows. A cursor
  that is not this album's index key (another album's, or one from an older deployment) fails with
  `InvalidCursor`, which restarts that hook. `getStoredAsset` returns one exact version. Neither
  contacts Storage or signs anything.
- `listStoredMedia` pages originals with their optional renditions. Configure up to four
  `originalSteps` and four named `renditions` on the server, for example:

  ```ts
  const media = await transloadit.listStoredMedia(ctx, {
    album: authorizedAlbum,
    originalSteps: [":original"],
    renditions: { playback: "video_encode", poster: "video_poster" },
    paginationOpts: args.paginationOpts,
  });
  ```

  Each page item is `{ original, renditions }`, containing canonical receipt rows with their
  provenance, not URLs. Step names are the **producers**, not the `/transloadit/store` Step names.
  Multiple original producers can preserve old uploads without a migration; their indexed streams
  merge newest first. Renditions never occupy their own pages. The app still authorizes every
  returned row, including previews, against its live access rules and server-created upload record.
  App authorization can therefore still leave an empty page.

  A rendition matches only one source ID (a string or single-element array), in the same Assembly,
  upload, album, user and Workspace. Missing, multi-input, ambiguous and deletion-requested
  renditions are omitted. No filename matching, Assembly-wide result scan or Storage request is
  performed. Original-only items remain visible even without a source ID. The existing cursor and
  page-split contract applies; pages are capped at 100 originals, with loaded ranges split at 200
  originals to bound rendition lookups. Producer mappings are app configuration, not browser input.
  An optional `createdAfter` (exclusive Unix timestamp in milliseconds) bounds the original index
  reads before pagination. Keep that cutoff fixed for a pagination session, so a gallery doesn't
  page through history it will hide. This is a display filter, not deletion or access control.

  For an exact shared link, use the same grouping without walking the album:

  ```ts
  const media = await transloadit.getStoredMedia(ctx, {
    album: authorizedAlbum,
    assetId: args.assetId,
    versionId: args.versionId,
    originalSteps: [":original"],
    renditions: { playback: "video_encode", poster: "video_poster" },
  });
  ```

  The Workspace defaults to the client's Storage configuration. The result is `{ original,
  renditions }`, or `null` for an unknown, hidden, wrong-album or non-original version. This exact
  lookup does not apply the listing's display cutoff. Authorize the viewer and every returned
  receipt in your app before exposing metadata or delivery, just as for the listing.
- Deletion is a ledger for your own retention job: `previewStoredAssetExpiry` dry-runs a selection,
  `requestStoredAssetDeletion` hides every version of expired assets at once,
  `adoptStoredAssetsForDeletion` brings in Storage objects that no receipt registered, and
  `listStoredAssetDeletions` pages what still awaits deletion. Your server deletes those objects
  from Storage, then `completeStoredAssetDeletion` turns the rows into tombstones (or
  `failStoredAssetDeletion` records a retryable error).
- A tombstone stops a late notification from registering the deleted version again. It is a
  retained record, not an erasure: it keeps the receipt without its ThumbHash (path, size,
  checksums, dimensions), its Assembly provenance and its album, user and upload linkage. Nothing
  purges tombstones: the component keeps them and exposes no function to remove them.

Byte-identical originals depend on the Assembly. Store `:original` directly, as the wedding
example does for both photos and videos, rather than a filter or processing result. In particular,
the Community-plan watermark exemption applies to direct originals, not filtered originals.

Receipts are private metadata, not credentials. Signed Assembly fields are not ownership proof on
their own: bind receipts to server-created upload records and authorize every read, as the
example's `convex/media.ts` does. `makeTransloaditAPI` deliberately exposes no receipt queries.
A ThumbHash is a tiny preview of the image: return it only to viewers who may see a preview (the
example strips it from versions its guests may only fetch as originals).

## Webhook route

Transloadit sends webhooks as `multipart/form-data` with `transloadit` (JSON) and `signature` fields.
Keep the Convex ingestion function internal; only the HTTP route should invoke it. With the client
above, define:

```ts
// convex/transloadit.ts
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { transloadit } from "./transloaditClient";

export const queueWebhook = internalAction({
  args: {
    payload: v.any(),
    rawBody: v.optional(v.string()),
    signature: v.optional(v.string()),
  },
  handler: (ctx, args) => transloadit.queueWebhook(ctx, args),
});
```

`queueWebhook` verifies the raw body's signature before enqueueing anything. Do not expose a
`verifySignature` argument to clients or disable verification for HTTP requests. Configure
`TRANSLOADIT_WORKSPACE` too if these notifications should register Storage receipts.

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { handleWebhookRequest } from "@transloadit/convex";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleWebhookRequest(request, {
      mode: "queue",
      runAction: (args) => ctx.runAction(internal.transloadit.queueWebhook, args),
    }),
  ),
});

export default http;
```

## Uppy client

Use Uppy + `@uppy/transloadit` directly. Start at
[`WeddingUploadsClient.tsx`](example/app/WeddingUploadsClient.tsx): it calls the authorized wedding
action for each batch, derives its file count from Uppy, and handles authentication and upload errors.
[`useWeddingUppy.ts`](example/app/useWeddingUppy.ts) and
[`createWeddingUppy.ts`](example/app/createWeddingUppy.ts) manage the Uppy instance and plugin.
Start from that flow rather than exposing a generic signing action.

`assemblyOptions()` is called once per batch. Use Uppy file metadata for per-file values and
Assembly `fields` for shared display values, not as the sole ownership proof. The optional wedding
invitation code belongs to sign-in, not the upload action.

Migration note: the `@transloadit/convex/react` entrypoint has been removed; use Uppy +
`@uppy/transloadit` directly.

For status parsing and polling helpers, see `docs/advanced.md`.

## Example app (Next.js + Uppy wedding gallery)

New to Storage and Smart CDN? Try the small, framework-neutral SDK example first:

```bash
npx @transloadit/node@latest init upload-once my-gallery
cd my-gallery
npm run demo
```

It opens browser login when needed, stores one original and renders three variants. Edit the sizes
and rerun it without re-uploading the matching original. The
[canonical example](https://github.com/transloadit/node-sdk/tree/main/packages/node/examples/upload-once)
is shipped and tested with the CLI; this repository does not maintain a copy. You need a
Storage-enabled workspace. Initialization only creates local files and installs dependencies;
running the demo uploads. This does not configure Convex or deploy the wedding app.

### Build a user-uploaded gallery

The `example/` app is a wedding gallery where guests upload photos + short videos. It uses Uppy on
the client and Convex Auth with a required guest name to enter the album. Hosted uploads store
original photos/videos, MP4 playback renditions and posters in private Transloadit Storage.
`@transloadit/viewer` supplies image rendering, authorized delivery redirects and download links;
the browser's native video player uses the same delivery route. No R2 credentials are needed for
any uploads. An optional saved Transloadit Template holds the reusable processing recipe.

Live demo: `https://convex-demo.transload.it`

For setup, deployment, and verification details, see [CONTRIBUTING.md](CONTRIBUTING.md).
Use separate server-side application credentials, not the local example's browser-login key:
CLI logout revokes that key. The wedding app shares Storage receipts, Built-in previews and the
published Viewer with the SDK ecosystem, but keeps guest authorization, webhook ownership and
retention policy in the app. The local example's static catalog is not a replacement for the
component's reactive receipt queries.

The [living DAM plan in API2](https://github.com/transloadit/api2/blob/main/docs/prompts/2026-10-15-handover-dam.md)
tracks the cross-repository dogfooding work, release boundaries and next product slice.

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
not verified identities. New media links reauthorize the guest before issuing a short-lived CDN
grant. Existing R2 media URLs remain public to anyone who has the link; this change cannot make
them private retroactively. The legacy in-memory session API and direct R2 pipeline have been
removed; local and hosted albums use Convex Auth and require Storage.
The globe menu switches between English, Dutch, Ukrainian, and German without discarding selected
files; the `NEXT_LOCALE` cookie remembers the choice. Like the content site, this uses `next-intl`
and ICU messages. Edit the complete catalogs in `example/messages/`; `yarn check` verifies their
keys and formatting. Uppy receives the same locale, with compatibility additions in
`example/i18n/uppy.ts`. Filenames, guest names, and wedding configuration remain user content.

Opening media writes its exact asset/version to the URL; sharing or reloading that URL opens the
same item after album admission, even outside the loaded gallery page. Next/previous updates the
slide and URL immediately, with a removable blur and loading feedback. Viewer warms only the next
photo after the current one loads, skipping slow/data-saving connections and videos. The dialog
supports keyboard navigation, Back/Forward, focus restoration and reduced motion. See [the wedding archive recommendation](docs/wedding-gallery.md) before using
the disposable demo for real wedding media. Demo retention and private delivery do not replace a
separate archive and a tested backup/restore.
