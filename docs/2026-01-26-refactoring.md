# 2026-01-26 Refactoring Proposal: Align with Uppy + Shared SDKs

This proposal responds to Merlijn's review and issue #20 (type duplication). It focuses on:

- Removing custom Uppy + React hooks in favor of official Uppy patterns.
- Reusing existing Transloadit SDKs where it makes sense.
- Reducing type duplication by leaning on Zod schemas and convex-helpers.
- Keeping the current component stable while introducing a cleaner, long-term path.

## Context (today)

- We ship custom React hooks (`useTransloaditUppy`, `useTransloaditUpload`) and a bespoke tus uploader.
- We already use `@transloadit/utils` for signature verification and `@transloadit/zod/v3` for types.
- The example app uses Uppy Dashboard but not `@uppy/transloadit`.
- Some types and validators are duplicated between Convex validators (`v.*`) and Zod schemas.

## Research highlights

- Uppy 5.0 ships official React hooks and recommends using them via `UppyContextProvider`.
- `@uppy/transloadit` is the canonical plugin; it uses Tus internally and supports
  `assemblyOptions` as a function that can call a backend for signatures.
- Convex allows marking external packages for Node actions, so a heavier SDK like `transloadit`
  can be used server-side without client bundle impact.
- `convex-helpers` provides Zod-based function argument validation and optional `zodToConvex`
  helpers for schema definitions, with caveats.

## Feasibility assessment

### 1) Replace custom hooks with Uppy + @uppy/transloadit

Feasible and recommended.

We can:
- Add a Convex action that returns `assemblyOptions` (params + signature + fields).
- Use `@uppy/transloadit` in the example and docs.
- Let Uppy manage Tus uploads and its own upload lifecycle.
- Keep Convex as the source of truth for webhooks, results, and auth.

This lets us remove:
- `tus-js-client` usage in React
- `useTransloaditUppy`
- `uploadWithTus` and related helpers

We can keep a small helper that wires `assemblyOptions()` to a Convex HTTP endpoint or action.

### 2) Reuse the `transloadit` Node SDK server-side

Likely feasible, but optional.

Convex Node actions can import external packages. That means we could:
- Use the `transloadit` SDK inside `createAssembly` and `refreshAssembly` actions.
- Avoid re-implementing API logic and edge-case handling.

Tradeoffs:
- Adds dependency weight.
- Need to verify ESM/CJS interop.
- Might require a Convex `convex.json` config change or explicit guidance for adopters.

Alternative: keep the lightweight `fetch` + `@transloadit/utils` approach to avoid dependency risk.

### 3) Type duplication (issue #20)

We can reduce duplication without fully replacing Convex validators:

- Keep table schemas in `convex/values` (Convex requires these).
- Use `convex-helpers` Zod wrappers for function args, so we only define args once and
  share types with `@transloadit/zod/v3`.
- Export Zod-based types from `@transloadit/convex` (already done) and avoid re-defining
  assembly and results types in multiple files.

This aligns with Convex guidance: Zod is great for args; use `zodToConvex` for DB schemas only
when the tradeoffs are acceptable.

## Proposed direction (phased)

### Phase 0: Remove custom hooks + expose the official path (short)

- Remove `useTransloaditUppy`, `useTransloaditUpload`, and tus helpers from exports and docs.
- Add an explicit “Recommended path” that uses Uppy + `@uppy/transloadit`.
- Add a minimal helper: `createAssemblyOptions` action + `getAssemblyOptions()` client helper.

### Phase 1: Example app refactor (short)

- Switch example app to `@uppy/transloadit`.
- Use Uppy React hooks (`@uppy/react`) and `UppyContextProvider`.
- Keep webhooks/results via Convex.
- Remove `tus-js-client` dependency from React path.

### Phase 2: API surface reduction (medium)

- Remove remaining Uppy-specific helpers from `@transloadit/convex/react`.
- Keep only status/results helpers (or remove the React entry entirely if unnecessary).

### Phase 3: Optional server SDK adoption (medium)

Likely **not** needed. Keep `fetch` + `@transloadit/utils` unless we can demonstrate:
- clear edge-case improvements over the current implementation, or
- significant DX improvements without extra complexity.

### Phase 4: Type cleanup (medium)

- Use convex-helpers Zod wrappers for function args.
- Consider replacing some hand-written validators (where safe).
- Add explicit mapping from Zod types -> Convex validators only where we benefit.

## Why we might *not* take some suggestions (yet)

- Rewriting the entire component around Uppy + SDKs in one shot risks regressions and
  would delay iteration. Phased adoption is safer.
- The `transloadit` SDK brings benefits, but also increases dependency complexity.
  If the current `fetch` + `@transloadit/utils` approach already works well, we may
  choose to keep it until a clear edge-case benefit is demonstrated.

## Open questions

1. Should `@transloadit/convex/react` remain as a small status/results hook library,
   or be removed entirely in favor of Uppy React hooks?
2. `createAssemblyOptions` should support both templates and inline steps.
3. Avoid requiring `convex.json` changes unless we adopt the `transloadit` SDK for
   clear edge-case wins.

## Success criteria

- Uppy integration follows official hooks + plugin usage.
- Reduced duplication (fewer custom helpers + better type reuse).
- Smaller surface area in `@transloadit/convex/react`.
- No regressions in webhook handling or results storage.
