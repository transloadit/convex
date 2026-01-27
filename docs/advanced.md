# Advanced usage

This page collects optional helpers that build on the Uppy-first integration path.

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

By default, the README shows the queued flow. If you need synchronous handling, you can use:

```ts
return handleWebhookRequest(request, {
  mode: "sync",
  runAction: (args) => ctx.runAction(api.transloadit.handleWebhook, args),
});
```
