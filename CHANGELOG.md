# @transloadit/convex

## 0.2.1

### Patch Changes

- Align client metadata fields with the backend's object validator and refresh generated Convex bindings.
  This preserves typechecking after deploying the example or regenerating component types.

## 0.2.0

### Minor Changes

- 3dcadd2: Refresh dependencies and support Node.js 24.15+ and 26+. Consolidate webhook verification so only
  the signed body is persisted, and preserve an explicit trusted verification opt-out in queued jobs.

  Modernize the wedding example with Motion photo viewing, persistent export selection, shared upload
  helpers, and a single backend source for deployment QA. Expand example typechecking and browser
  verification, and repair the macOS webhook tunnel bootstrap.

## 0.1.0

### Minor Changes

- e14fee2: - switch the example and docs to Uppy + @uppy/transloadit and remove the React/tus helpers
  - add signed assemblyOptions helpers and ensure expected upload counts are included in params
  - update docs for the new Uppy-first integration path

## 0.0.6

### Patch Changes

- a8389a0: Docs: clarify results table stores one row per output file per step.

## 0.0.5

### Patch Changes

- Add demo retention tooling and document R2 lifecycle expiry.

## 0.0.4

### Patch Changes

- b45892d: chore: validate changesets release flow
