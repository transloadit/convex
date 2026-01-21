# Refactor plan (2026-01-21)

## Vision: ideal DX
A Convex developer should be able to:

1. Create an Assembly securely (server‑only).
2. Upload files resumably from the client with one helper (no URL juggling).
3. Get results + status updates in realtime (or polling fallback) with one hook.
4. Handle webhooks with one handler helper (queue or sync).
5. Never touch Transloadit’s legacy response shape, signatures, or schema plumbing.
6. Use the same patterns in local test + CI + cloud without rewiring.

## Target interface

Server:

```ts
const api = makeTransloaditAPI(components.transloadit);
```

HTTP handler (single helper):

```ts
import { handleWebhookRequest } from "@transloadit/convex";

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleWebhookRequest(request, {
      mode: "queue",
      runAction: (args) => ctx.runAction(api.transloadit.queueWebhook, args),
    }),
  ),
});
```

Client:

```ts
const { upload, status, results } = useTransloaditUpload({
  createAssembly: api.transloadit.createAssembly,
  getStatus: api.transloadit.getAssemblyStatus,
  refresh: api.transloadit.refreshAssembly,
});

await upload(files, { steps, notifyUrl, fields });
```

Uppy:

```ts
const { startUpload, poll } = useTransloaditUppy({
  createAssembly: api.transloadit.createAssembly,
});
```

## Ownership boundaries

Convex component should own:
- Convex‑native wrappers and hooks.
- Durable queueing (`queueWebhook`) with retries.
- Convex‑idiomatic polling helpers (query + refresh).
- Opinionated defaults (expires, rate‑limit backoff).
- Local test harness.

Transloadit SDK packages should own:
- Signature verification and signing (`@transloadit/utils`).
- Schema types + guards (`@transloadit/zod`, `@transloadit/types`).
- Upload URL normalization + status stage derivation.

## TODO list (to completion)

- [ ] Add `handleWebhookRequest(request, { mode, runAction, authSecret?, requireSignature? })`.
- [ ] Update README to show a single webhook handler example using `handleWebhookRequest`.
- [ ] Add a `useTransloaditUpload` hook that returns `{ upload, status, results }` and covers the 80% flow.
- [ ] Add a `useTransloaditUppy` helper (wraps `uploadWithAssembly` + polling) as the blessed Uppy path.
- [ ] Move URL normalization + `getAssemblyStage` to `@transloadit/utils` or `@transloadit/zod` and re‑export from convex.
- [ ] Replace example app’s bespoke wiring with the new hooks/helpers.
- [ ] Update QA/test harness to use the new helpers (no duplicated logic).
- [ ] Add unit tests for `handleWebhookRequest` and the new hooks.
- [ ] Re‑audit README for drift once the new helpers land.
