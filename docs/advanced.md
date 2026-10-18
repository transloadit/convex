# Advanced usage

This page collects optional helpers that build on the Uppy-first integration path.

## Legacy public wrappers

`makeTransloaditAPI(component, config)` and `client.api()` still return the same public Convex
functions for compatibility, but are deprecated. They do not check authentication, album membership
or Assembly ownership. Merely keeping the API secret server-side does not make those endpoints
safe: callers can request signatures for their own Steps, read metadata or invoke `purgeAlbum`.

For an existing integration, replace the exported factory functions with app-owned wrappers around
`new Transloadit(components.transloadit)` (or direct component calls):

- Authorize public signing actions and fix the recipe, ownership fields and Storage paths on the
  server. Do not accept arbitrary `CreateAssemblyArgs` from the browser.
- Authorize reads and refresh against the caller's album/Assembly, not just a logged-in session.
- Keep webhook ingestion, metadata writes and cleanup internal. Update HTTP routes and server
  callers to use `internal.transloadit.*` references when moving a function from public to internal.
- Keep receipt reads app-owned; the factory does not expose them or the `assemblyFields` selector.

Use the [wedding app's functions](../example/convex/) as the concrete reference. Existing factory
exports are not changed automatically by upgrading this package; review them before deploying.
The class's writable `config` API and explicit credential overrides remain supported. Environment
credentials resolve when an operation needs them, so local receipt reads and codegen need neither
an Assembly key nor a secret. Webhook handlers need only the secret; signing and refresh need both.
Reading or copying `client.config` also evaluates its credential getters and can throw if credentials
are absent. Do not serialize that credential-bearing object into logs or browser data.

## Typed helpers (raw payload parsing)

When working with raw assembly payloads, use these helpers to avoid stringly-typed access.
They are validated with `@transloadit/zod/v3`.

```ts
import {
  normalizeAssemblyUploadUrls,
  parseAssemblyFields,
  parseAssemblyResults,
  parseAssemblyStatus,
  parseAssemblyUrls,
} from "@transloadit/convex";

const assembly = await createAssembly(...);
const { tusUrl, assemblyUrl } = parseAssemblyUrls(assembly.data);
const normalized = normalizeAssemblyUploadUrls(assembly.data);
const status = parseAssemblyStatus(assembly.data);
const fields = parseAssemblyFields(assembly.data);
const results = parseAssemblyResults(assembly.data);
```

Status guards:

```ts
import { isAssemblyTerminal, isAssemblyTerminalError } from "@transloadit/convex";
import { getAssemblyStage } from "@transloadit/convex";

const stage = getAssemblyStage(status); // "uploading" | "processing" | "complete" | "error" | null
```

Typed results by robot name:

```ts
import type { ResultForRobot } from "@transloadit/convex";

type ResizeResult = ResultForRobot<"/image/resize">;
type EncodeResult = ResultForRobot<"/video/encode">;
```

Polling fallback (no webhooks):

```ts
import { pollAssembly, isAssemblyTerminal } from "@transloadit/convex";

const controller = pollAssembly({
  intervalMs: 5000,
  refresh: async () => {
    await refreshAssembly({ assemblyId });
  },
  isTerminal: () => isAssemblyTerminal(status),
});

// controller.stop();
```

## Optional demo template tooling

If you prefer Transloadit templates for demos, you can create/update an idempotent
"convex-demo" template locally:

```bash
yarn template:ensure
```

This reads `TRANSLOADIT_KEY/TRANSLOADIT_SECRET` from `.env` and prints the template id.

## Webhook handling (sync mode)

By default, the README shows the queued flow. For synchronous handling, define an `internalAction`
with the same webhook validators as that example, calling `transloadit.handleWebhook(ctx, args)`
instead. The HTTP route then uses its internal reference:

```ts
return handleWebhookRequest(request, {
  mode: "sync",
  runAction: (args) => ctx.runAction(internal.transloadit.handleWebhook, args),
});
```
