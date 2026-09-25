# From demo to a wedding archive

Recommendation, 16 September 2026: deploy a separate private wedding instance of the example,
sharing its gallery and upload components. Keep the public demo disposable. Use a dedicated
Convex deployment and storage namespace so demo cleanup, test uploads, and guest access cannot
affect the wedding archive.

## What the demo already provides

- Resumable Uppy uploads of photos and videos, with signed Transloadit Assembly options.
- Image resizing, video encoding, video posters, and export to Cloudflare R2.
- Convex status/results, live gallery updates, and named guest sessions.
- Required name entry, an optional invitation code for viewing and uploading, and a small per-session upload limit.
- Editable contributor names on uploads, four interface languages, and search-engine exclusion.
- A Motion `AnimateView` photo viewer with keyboard navigation and reduced-motion support.

The [Motion announcement](https://x.com/motiondotdev/status/2100212174413062260) introduces
`AnimateView` in Motion 13.4. It is open source, works with React 19.3, and supports shared-element
view transitions and springs. See the [official API](https://motion.dev/docs/react-animate-view).
An animation library handles presentation; it does not provide albums, access control, or storage.

## Required before importing the real wedding

| Area | Current demo | Wedding instance |
| --- | --- | --- |
| Retention | The UI defaults to 24 hours; the demo R2 lifecycle deletes objects after one day. | Separate bucket/workspace with explicit permanent retention. Setting the gallery retention to zero only removes the UI cutoff; it cannot undo bucket deletion. Exclude it from demo cleanup. |
| Originals | Processing persists resized photos, encoded videos, and posters. | Preserve untouched originals and checksums as well as viewing derivatives. Keep an independent backup and demonstrate a restore. |
| Viewing privacy | Album queries require a named guest session and the invitation code when configured. Direct media links remain public. | Configure a strong invitation code, private storage, and authorized delivery/downloads. Protect thumbnails and video URLs too. Without a code, anyone can enter a name. |
| Backend authorization | Album reads require admission; status/results/refresh require ownership. Signing uses a fixed wedding action; ingestion and cleanup are internal. Logout and code changes revoke album access. | Extend membership checks to future editing and delivery paths. Names are self-reported. Use named Template credentials: raw R2 keys in inline instructions are visible to the uploader even when the diagnostic display is redacted. |
| Ingestion | Guest batches are capped at 12 files; authenticated sessions have a six-batch hourly limit. | Separate owner/photographer bulk import with resumability, deduplication, progress, and retry/reconciliation. Keep tighter guest limits, including file size and total storage quotas. |
| Organization | One demo album and a small capped result query. | Persistent asset records, pagination, photographer/our photos/guest collections, capture dates and time zones, contributor credit, and stable ordering. |
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

Status, 25 September 2026:

- **Originals.** With `TRANSLOADIT_WORKSPACE` configured, photo originals are stored with
  `/transloadit/store` under a server-chosen `convex-demo/<deployment>/<album>/<upload>/` prefix,
  with a ThumbHash. Without it, uploads keep the R2-only pipeline.
- **Receipts.** The component registers each verified receipt once, with its Assembly provenance.
  The app binds it to the server-created upload record (album, guest and prefix) before listing it.
- **Sessions.** Hosted albums use the official Convex Auth Next.js integration: tokens live in
  httpOnly cookies, refreshed by `proxy.ts`, so server routes can authorize the viewer.
- **Authorization.** `media:forDelivery` is the delivery route's single check: a live session with
  the current invitation, this album, the exact retained version and an explicit `preview`,
  `original` or `download` action. It returns the stored receipt or `null`.
- **Pending.** The `/api/transloadit/media` route and the gallery switch to Viewer's React `Image`
  wait for the Viewer alpha that ships them. Until then the gallery still shows the R2 renditions.
- **Video** stays on R2. The album is not private end to end while video uses public R2 URLs.

Delivery semantics, as verified against production with synthetic assets:

- Every route request reauthorizes and redirects to a freshly signed, exact-version CDN URL.
  Receipts pin `asset_id` and `version_id`, so renames keep working and overwrites never change
  the bytes a receipt selects. Tampered parameters fail the signature; unknown versions return 404.
- An issued CDN URL is a bearer grant until its expiry. The CDN keys its cache on the full query and
  enforces expiry on cache hits too. Signing rotates at most once a minute, so a newly signed URL can
  equal one already cached; it is still bounded by that expiry.
- Storage deletion is a soft delete: new origin reads fail at once, while cached responses remain
  usable until their URLs expire and downloaded bytes cannot be recalled. That is why cleanup hides
  assets in Convex first, so the app stops issuing new redirects before any bytes are deleted.

Demo retention: `node scripts/cleanup-demo.ts --older-than=24` expires Storage photos older than a
day through the ledger (hide, delete, then drop references; failures stay hidden and retryable).
Without `--older-than` the script resets the whole demo album, including unregistered uploads under
this deployment's prefix, R2 objects and Convex results. `--dry-run` reports every backend and changes
nothing. Cleanup never deletes Storage assets outside the deployment's demo prefix. Scheduling the
daily expiry is still open; R2 keeps its one-day lifecycle rule.

For the real wedding, an independently tested backup and restore of the originals remains a gate,
along with a separate Workspace or prefix that demo cleanup can never reach.
