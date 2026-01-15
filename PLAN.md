# Transloadit Convex Component Plan

## Assessment of the original plan
The issue plan is directionally correct (aligns with Convex component patterns and the Cloudinary reference), but it is too broad and lacks execution-level detail on:
- What the minimal API surface is for the challenge deadline.
- How assemblies/results are persisted and updated (webhook vs polling).
- How to keep file uploads within Convex limits (form upload vs tus).
- The exact component/public API wrappers needed by Convex apps.
- Testing strategy and CI gates.

## Revised plan

### MVP (Challenge-ready)
1. **Component package scaffold**
   - Yarn 4 workspace, TypeScript build, Vitest, Biome, GitHub Actions CI.
   - Convex component entrypoints: `convex.config`, `lib`, `react`.

2. **Core component data model**
   - `assemblies` table: stores assembly id, status, raw webhook payload, userId, timestamps.
   - `results` table: stores per-step results, indexed by `assemblyId` + `stepName`.

3. **Core Convex API**
   - `createAssembly` (action): sign params, call Transloadit, store assembly.
   - `generateUploadParams` (action): return `params` + `signature` for browser form upload.
   - `handleWebhook` (action): verify signature, upsert assembly, replace results.
   - `getAssemblyStatus`/`listAssemblies` (queries).
   - `listResults` (query).
   - `storeAssemblyMetadata` (mutation) for app-side enrichment.

4. **React hooks**
   - `useTransloaditUpload` (form upload with progress).
   - `useTransloaditTusUpload` (resumable upload using tus-js-client).
   - `useAssemblyStatus` + `useTransloaditFiles` for reactive status/results.

5. **Tests & CI**
   - Unit tests for signing + webhook verification.
   - Component tests for webhook ingestion + result persistence using `convex-test`.
   - CI runs lint, typecheck, tests.

### Phase 2 (Post-MVP)
- Add richer typed step/result schemas, helpers for common templates.
- Optional polling-based status refresh for non-webhook setups.
- Retry handling for failed assemblies.
- Example app for the component directory submission.

### Phase 3 (Polish)
- Documentation: setup, API reference, recipes, troubleshooting.
- Optimized tus defaults and resume behavior.
- Publish to npm with versioning & changelog.
