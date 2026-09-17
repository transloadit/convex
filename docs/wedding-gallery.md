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

## Dogfooding Transloadit Storage and `@transloadit/img`

This is a useful second consumer: real user uploads need dynamic receipts and private delivery,
which exercise different paths from a static marketing website.

The current local SDK implements `@transloadit/img` as a private, unpublished package. Its Next.js
adapter renders native responsive `picture/srcset` markup, has a private delivery route and an
application-provided authorization callback, and accepts application-held upload receipts. The
existing Content integration uses matching vendored SDK packages. Sources:
[SDK image package](https://github.com/transloadit/node-sdk/tree/img-onboard/packages/img),
[SDK integration](https://github.com/transloadit/node-sdk/pull/500), and
[Content integration](https://github.com/transloadit/content/pull/5973).

Recommended boundary:

- Convex owns wedding membership, albums, contributors, moderation, processing status, and asset
  receipts. Store dynamic upload receipts in Convex; do not append every guest photo to a Git catalog.
- Transloadit processes media and Storage holds originals/derivatives. Record durable storage
  identity and dimensions on the asset, independently of an Assembly's temporary result URL.
- `@transloadit/img` renders responsive image derivatives through a server component or authorized
  image endpoint. The interactive Motion viewer wraps that presentation boundary. The current
  gallery is a client component, so importing the server adapter directly into it is not sufficient.
- Videos continue through a separate player/poster/streaming path; the image component is not a
  video player or the entire DAM.

Prove the integration first with disposable fixtures in an isolated deployment. As of this review,
package publication, production Storage/API/CDN delivery, and independently tested backup/restore
remain gates in that workstream. A green package build alone is not proof of durable production
hosting. Until those gates clear, use dedicated persistent R2 storage for the wedding, retain an
independent original backup, and keep the rendering/storage boundary easy to switch.

The next useful implementation slice is a private album plus durable original ingestion and a
small Storage/image proof. A second copy of the entire example would add maintenance without
addressing those missing behaviors.
