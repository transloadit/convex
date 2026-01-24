# 2026-01-22 Refactoring Proposal (Docs + DX Simplification)

## Goals
- Make the README + example feel **effortless**: one clear happy path.
- Remove distractions (low-level helpers, template CLI, double-verification caveats).
- Keep advanced/legacy helpers available but **out of the main flow**.
- Prefer **normalized return shapes** from the Convex module so users don’t need to parse raw payloads.

## Proposed Decisions
1. **Retire low-level helpers from docs**
   - Stop mentioning:
     - `uploadWithTransloaditTus`
     - `useTransloaditTusUpload`
     - `useAssemblyPoller`
   - Keep them exported for advanced use, but add a short “advanced/legacy” note in API docs (or a separate `docs/advanced.md`).

2. **Remove template CLI section from README**
   - Keep `scripts/ensure-template.ts` for maintainers.
   - Move a brief note to CONTRIBUTING or `docs/maintenance.md`:
     - “Optional: create/update a demo template for internal testing.”
   - README should show **inline steps only**.

3. **Simplify webhook guidance**
   - Remove note about pre-verification vs action verification.
   - Default story: `handleWebhookRequest` verifies and then stores/queues.
   - Mention queue only as an internal detail or in advanced docs.

4. **Clarify `expires`**
   - Replace “default is 1h” note with **where to set it**:
     - “Pass `expires` on `createAssembly` or in `steps` if needed.”
   - If we keep a default, document it near `createAssembly` usage.

5. **Make results less “raw” in user-facing docs**
   - In README: describe that `results` contains one row per output file, and each row contains:
     - normalized fields (name/size/mime/url)
     - and a `raw` payload (the Transloadit output object)
   - Avoid deep payload details in main README.

6. **Prefer a single Uppy-based flow in README**
   - Show only:
     - `useTransloaditUppy`
     - the example app (wedding gallery)
   - Do not document low-level tus helpers or `useTransloaditUpload` in README.

7. **Normalized output from module (DX uplift)**
   - Add a new “cleaned” return shape from key helpers:
     - `createAssembly` should return `{ assemblyId, data, tusUrl, assemblyUrl, params }`
     - `useTransloaditUppy` should expose `assemblyUrls` + `params` directly
   - This removes the need for docs listing `parseAssemblyUrls`, `normalizeAssemblyUploadUrls`, etc.
   - If we keep those helpers, hide them under “advanced.”

8. **Typed results as module responsibility**
   - Instead of asking users to use `ResultForRobot`:
     - Provide `normalizeResults(results)` or similar which returns typed-safe shapes for common robots
     - Unknown robots get a generic `RawResult`.
   - README only mentions “typed results available for common robots.”

## Proposed README Restructure
- **Top**: What this is + quickstart.
- **Flow**: single Uppy + webhook flow (with inline steps).
- **Example**: wedding app (cloud/local).
- **Results**: how to read the gallery data (with normalized fields).
- **Deployment**: cloud/local verification scripts.
- **Advanced**: link to `docs/advanced.md` (low-level helpers, templates, parsing helpers).

## Implementation Tasks
- [ ] README: remove low-level helper sections + template CLI section.
- [ ] README: simplify webhook guidance (no double verification notes).
- [ ] README: show only Uppy flow + example app.
- [ ] Add `docs/advanced.md` with:
  - low-level tus helpers
  - manual `parseAssemblyUrls`/`buildTusUploadConfig`
  - template CLI notes
- [ ] Update API docs to clarify `expires` placement.
- [ ] Add normalized return shape(s) to module public API.
- [ ] Add result-normalization helper for common robots.
- [ ] Update example to consume normalized outputs (no raw parsing).

## Open Questions
- Should we **remove** the low-level exports entirely in v0.x, or keep them for now as “advanced”? (Proposal: keep exports, remove from README.)
- Do we want `handleWebhookRequest` to always queue by default, or process inline? (Proposal: keep queue internally but hide from README.)
- Should we add `docs/maintenance.md`, or extend CONTRIBUTING for template CLI notes? (Proposal: add `docs/advanced.md`, keep maintenance in CONTRIBUTING.)

## Recommendation
Proceed with the doc simplification + add normalized outputs. Keep low-level helpers for now but treat them as legacy/advanced.
