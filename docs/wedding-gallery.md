# From demo to a wedding archive

Deploy a separate private wedding instance of the example,
sharing its gallery and upload components. Keep the public demo disposable. Use a dedicated
Convex deployment and storage namespace so demo cleanup, test uploads, and guest access cannot
affect the wedding archive.

## What the demo already provides

- Resumable Uppy uploads of photos and videos, with signed Transloadit Assembly options.
- Private Transloadit Storage originals, MP4 playback and posters; adaptive image delivery via Viewer.
- Convex status/results, live gallery updates, and named guest sessions.
- Required name entry, an optional invitation code for viewing and uploading, and a small per-session upload limit.
- Editable contributor names on uploads, four interface languages, and search-engine exclusion.
- Exact-photo/video links, immediate navigation with blur/loading feedback, keyboard navigation,
  and reduced-motion support. The gallery selects one neighboring photo to warm after the current
  image loads; Viewer skips speculative loading on slow/data-saving connections.

## Required before importing the real wedding

| Area | Current demo | Wedding instance |
| --- | --- | --- |
| Retention | UI/query cutoff defaults to 24 hours; scheduled Storage cleanup expires originals and derivatives. Old R2 objects retain a one-day lifecycle. | Separate Workspace/prefix and explicit permanent retention, excluded from demo cleanup. Removing the UI cutoff alone does not prevent deletion. |
| Originals | New photo and video originals are stored directly, separately from playback derivatives. | Keep an independent backup and demonstrate a restore; test intended source formats. |
| Viewing privacy | Album and new media delivery require an admitted guest. Short-lived CDN grants remain usable until expiry. Legacy R2 links stay public. | Configure a strong invitation code and separate archive. Without a code, anyone can enter a name. Do not import public legacy links as if they were private. |
| Backend authorization | Album reads and exact-version links require admission; status/results/refresh require ownership. Signing uses a fixed wedding action; ingestion and cleanup are internal. Logout and code changes revoke album access. | Extend membership checks to future editing and delivery paths. Names are self-reported. Keep credentials server-side. |
| Ingestion | Guest batches are capped at 12 files; authenticated sessions have a six-batch hourly limit. | Separate owner/photographer bulk import with resumability, deduplication, progress, and retry/reconciliation. Keep tighter guest limits, including file size and total storage quotas. |
| Organization | One album, persistent Storage receipts, paginated private media and contributor credit. | Add collections and capture dates/time zones only as needed for the real archive. |
| Moderation | Successful uploads appear immediately. | Owner approval/hide/delete, a recoverable trash state, and upload acknowledgements. Explain who can see submitted files. |
| Media | Basic resize and MP4 processing. | Verify HEIC, rotated phone photos, HDR/large phone videos, and photographer formats. Generate useful thumbnail sizes; add streaming renditions for long videos if needed. |
| Operations | Demo diagnostics and test scripts. | Failed-upload recovery, storage/processing spend limits, monitoring, backups, download/export, and a restore procedure. |

Start with photographer-selected JPEGs and finished video exports; keep RAW files in the independent
archive unless browsing/editing RAW is a real requirement. Import a small mixed batch and verify
private viewing, full-resolution downloads, mobile playback, guest uploads, moderation, and backup
restoration before the full collection or guest invitations.

## Dogfooding Transloadit Storage and `@transloadit/viewer`

This album is the second real consumer of Storage and Viewer, after the Transloadit website: real
guest uploads need dynamic receipts and private delivery, not a committed image catalog.

Current implementation (October 2026; deployment must be verified separately):

- **Originals.** With the required `TRANSLOADIT_WORKSPACE`, photos and videos are stored with
  `/transloadit/store` under a server-chosen `convex-demo/<deployment>/<album>/<upload>/` prefix,
  with photo ThumbHashes for placeholders. The store Step uses `:original` directly to preserve
  uploaded bytes, including on the Community plan. Missing configuration or a pause refuses new
  hosted uploads, never falls back to public storage.
- **Receipts.** The component registers each verified receipt once, with its Assembly provenance.
  The app binds it to the server-created upload record (album, guest and prefix) before listing it.
- **Sessions.** Hosted albums use the official Convex Auth Next.js integration: tokens live in
  httpOnly cookies, refreshed by `proxy.ts`, so server routes can authorize the viewer. Guests who
  entered before this change enter their name (and code) once more; their old browser-stored token
  is not migrated.
- **Authorization.** `media:forDelivery` is the delivery route's single check: a live session with
  the current invitation, this album, the exact retained version and an explicit `preview`,
  `original` or `download` action. It returns the stored receipt or `null`.
- **Delivery.** `/api/transloadit/media` is Viewer's `createStorageRoute` with explicit,
  server-only `TRANSLOADIT_SMART_CDN_KEY`, `TRANSLOADIT_SMART_CDN_SECRET` and
  `TRANSLOADIT_SMART_CDN_WORKSPACE` (a least-privilege `smart_cdn:sign` key). The gallery renders
  thumbnails with `@transloadit/viewer/react` `Image` and full photos with `ImagePreview` from
  `@transloadit/viewer/react/preview`. It pages through `media:list` with cursors, freezing loaded
  pages so live uploads never shift photos between pages. A shared exact-version link outside the
  loaded pages uses the same album authorization through `media:get`. The example pins its
  published Viewer alpha in `example/package.json`.
- **Placeholders.** Thumbnails use `placeholder="blur"` with an explicit `objectFit="cover"`: the
  receipt's ThumbHash is painted as an inline background that the loaded opaque pixels cover, with
  no load handler. The full-photo `ImagePreview` removes its blur once the image loads and provides
  loading/error feedback without delaying navigation. Transparent photos get no blur. A ThumbHash
  is preview pixels, so album queries and `media:forDelivery` return it only to an admitted guest
  and only for versions that guest may preview.
- **Activation order.** Configure the delivery key on the Next.js host before enabling hosted
  uploads on Convex; without it the route answers 404. Validate in an isolated preview first.
- **Video.** `/video/encode` and `/video/thumbs` produce private stored MP4s and posters. They use
  Viewer's `getStorageAssetHref` and the same authorized route, with native browser playback/range
  seeking. Download selects the original, not the MP4. A missing derivative leaves an explicit
  preview-unavailable message and an original download, not a public fallback.
- **Consumer code.** `yarn template:ensure --wedding` optionally publishes the shared processing
  recipe. Only literal per-upload Storage paths stay in signed server instructions: multipart
  fields are untrusted destination inputs. The app owns admission and retention; it does not proxy
  media bytes or implement its own CDN signing. See `CONTRIBUTING.md` for setup.

Delivery semantics, as verified against production with synthetic assets:

- Every route request reauthorizes and redirects to a freshly signed, exact-version CDN URL.
  Receipts pin `asset_id` and `version_id`, so renames keep working and overwrites never change
  the bytes a receipt selects. Tampered parameters fail the signature; unknown versions return 404.
- An issued CDN URL is a bearer grant until its expiry, at most five minutes after signing. The CDN
  keys its cache on the full query and enforces expiry on cache hits too. Signing windows last 150
  seconds, so repeat requests within a window receive the same URL and can hit the CDN cache; each
  newly signed URL keeps 150-300 seconds of validity.
- Storage deletion is a soft delete: new origin reads fail at once, while cached responses remain
  usable until their URLs expire and downloaded bytes cannot be recalled. That is why cleanup hides
  assets in Convex first, so the app stops issuing new redirects before any bytes are deleted.

Storage namespaces: each deployment writes under `convex-demo/<namespace>/<album>/`. Convex cloud
deployments use their deployment name. Local and self-hosted deployments have no unique name, so a
configured `TRANSLOADIT_WORKSPACE` fails closed there until `TRANSLOADIT_STORAGE_NAMESPACE` names
one. Local browser QA uses the real gallery with controlled media; real upload, authorization and
delivery acceptance run separately against the isolated cloud preview.

Demo retention: `node scripts/cleanup-demo.ts --older-than=24` expires all Storage media older than a
day through the ledger: hide, delete, then keep a tombstone so a late notification cannot restore
the media. Failures stay hidden and retryable.
Without `--older-than` the script resets the whole demo album, including unregistered uploads under
this deployment's prefix and Convex results. `--dry-run` reports the selection and changes nothing.
Storage requires credentials; explicit `--skip-storage` leaves it and its database references
untouched and reports an incomplete reset. References stay in the ledger until Storage confirms
each deletion. Cleanup never deletes Storage assets outside the deployment's demo prefix.
The daily expiry workflow is prefix-bound to the disposable demo. No code in this repository
deletes legacy R2 objects or changes their external lifecycle.

For the real wedding, an independently tested backup and restore of the originals remains a gate,
along with a separate Workspace or prefix that demo cleanup can never reach.
