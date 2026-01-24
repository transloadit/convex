# Refactor TODO (2026-01-20)

- [x] Extract shared R2 config parsing/normalization into a single helper and reuse in:
      - `example/lib/transloadit-steps.ts`
      - `scripts/qa/app-template.ts`
- [x] Route webhook handling through the same wrapper in both runtime app and QA template:
      - `example/convex/http.ts` should call `./transloadit` wrapper (not raw component).
      - QA template should mirror the same pattern.
- [x] Unify assembly refresh polling:
      - One helper to handle local `/api/assemblies?refresh=1` vs cloud `refreshAssembly` action.
      - Use it in both Local + Cloud wedding flows.
- [x] Extract reusable Playwright diagnostics helper:
      - Console, request/response log, and failure dump.
      - Use in `test/e2e/upload.e2e.test.ts`.
- [x] Eliminate untyped step builders in QA template:
      - Generate steps via the typed builder used by the example app, or share a generator.
- [x] Normalize assembly response URL parsing:
      - Replace ad‑hoc `getAssemblyUrls` with a typed helper/schema.

# Refactor TODO (Showcase polish)

- [x] Add typed helpers for assembly responses:
      - `parseAssemblyFields`, `parseAssemblyResults`, `parseAssemblyStatus`.
      - Export a `TransloaditAssembly` type for the response shape.
- [x] Add a “create + tus upload” helper for the 80% use‑case.
- [x] Provide a webhook “safe mode” helper:
      - parse + verify signature + return typed payload.
- [x] Improve demo UX:
      - Upload timeline (created → uploading → processing → stored).
      - Per‑file cards with resized + video poster.
- [x] Tighten README golden path:
      - Short narrative flow, fewer code blocks, emphasize secure‑by‑default toggles.

# Refactor TODO (Full-stack DX)

- [x] Add a result schema smoke test that validates expected fields from `listResults`.
- [x] Add a helper that normalizes assembly upload URLs into a stable shape (`{ tus: { url }, assembly: { url } }`).
- [x] Add a helper for building Tus metadata + endpoint (Uppy-friendly) without app boilerplate.
- [x] Add a “verify + queue” convenience helper for Convex HTTP handlers.
- [x] Update README + example to use the new helpers where it keeps code cleaner.
- [x] Add a multi-file Tus helper with concurrency + cancellation + per-file/overall progress.
- [x] Add a “copy payload” panel in the example (shows createAssembly args, redacted).
- [x] Add a typed result map for common robots (image resize, video encode, store).
