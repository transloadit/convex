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
- [ ] Add a “create + tus upload” helper for the 80% use‑case.
- [ ] Provide a webhook “safe mode” helper:
      - parse + verify signature + return typed payload.
- [ ] Improve demo UX:
      - Upload timeline (created → uploading → processing → stored).
      - Per‑file cards with resized + video poster.
- [ ] Tighten README golden path:
      - Short narrative flow, fewer code blocks, emphasize secure‑by‑default toggles.
