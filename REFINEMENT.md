# Convex Component Refinement Plan

This document captures follow‑up improvements based on Convex component guidance and similar component repos. It is meant to be a living checklist.

## Verification tools

Run these locally before and after big changes to stay green:

- `yarn check` (format + lint + typecheck + unit tests) — primary fast gate.
- `yarn lint` (Biome)
- `yarn format` (Biome write)
- `yarn typecheck` (tsc)
- `yarn test` (Vitest unit tests)
- `yarn test:browser` (browser + webhook QA flow; slower)
- `yarn build` (tsc build + emit package json)

Notes:
- `yarn template:ensure` and `yarn tunnel` are support tools, not verification.
- CI should run the non‑mutating checks; local `yarn check` may format/fix.

## Todo list

### DX + API ergonomics
- [x] Add a `parseTransloaditWebhook` helper that accepts a `Request` and returns `{ payload, rawBody, signature }` to cut boilerplate in Convex HTTP routes.
- [x] Provide a class‑based wrapper (single public entrypoint) so usage mirrors other Convex components.
- [x] Export `@transloadit/convex/test` helpers for `convex-test` to mock component behavior.

### Type safety
- [x] Expand `@transloadit/types` usage beyond steps/fields (Assembly status, results, webhook payload).
- [ ] Replace `v.any()` in responses/results where concrete Transloadit types exist.

### Durability + reliability
- [x] Optional background queue or retry flow for webhook processing.
- [x] Optional polling fallback when webhooks are unavailable.

### Docs + examples
- [x] Add a diagram or short explanation of the `assemblies` + `results` tables and lifecycle.
- [x] Provide a minimal end‑to‑end snippet that uses the helper for webhook parsing.
- [x] Mention how `_generated` files are produced and why.

### QA
- [x] Confirm browser test covers template preflight + upload + webhook store.
- [x] Validate CLI helper behavior stays compatible with Transloadit CLI updates.

## References (re‑check as needed)

- Convex components authoring guide
- Convex official components (e.g. Resend, Aggregate)
- Transloadit API docs (assembly status + resumable uploads)
