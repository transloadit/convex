# Advanced usage

This page collects low-level helpers and optional maintenance tools. These are intentionally
kept out of the main README so new users can follow a single, Uppy-first path.

## Low-level tus helpers (advanced)

If you need a custom uploader (no Uppy), the legacy tus helpers are still available:

```tsx
import {
  uploadWithTransloaditTus,
  useTransloaditTusUpload,
  uploadFilesWithTransloaditTus,
} from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

function TusUpload() {
  const { upload, isUploading, progress } = useTransloaditTusUpload(
    api.transloadit.createAssembly,
  );

  const handleUpload = async (file: File) => {
    await upload(file, {
      templateId: "template_id_here",
      onAssemblyCreated: (assembly) => console.log(assembly.assemblyId),
    });
  };

  return (
    <div>
      <input type="file" onChange={(e) => handleUpload(e.target.files![0])} />
      {isUploading && <p>Uploading: {progress}%</p>}
    </div>
  );
}
```

Imperative helper (e.g. non-React):

```ts
import { useAction } from "convex/react";

const createAssembly = useAction(api.transloadit.createAssembly);

await uploadWithTransloaditTus(
  createAssembly,
  file,
  { templateId: "template_id_here" },
  { onStateChange: (state) => console.log(state) },
);
```

Multi-file uploads with concurrency + cancellation:

```ts
import { uploadFilesWithTransloaditTus } from "@transloadit/convex/react";

const controller = uploadFilesWithTransloaditTus(createAssembly, files, {
  concurrency: 3,
  onFileProgress: (file, progress) => console.log(file.name, progress),
  onOverallProgress: (progress) => console.log("overall", progress),
});

// Optional: cancel in-flight uploads
// controller.cancel();

const result = await controller.promise;
console.log(result.files);
```

## Reactive status/results helpers

```tsx
import { useAssemblyStatus, useTransloaditFiles } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

function AssemblyStatus({ assemblyId }: { assemblyId: string }) {
  const status = useAssemblyStatus(api.transloadit.getAssemblyStatus, assemblyId);
  const results = useTransloaditFiles(api.transloadit.listResults, {
    assemblyId,
  });

  if (!status) return null;
  return (
    <div>
      <p>Status: {status.ok}</p>
      <p>Results: {results?.length ?? 0}</p>
    </div>
  );
}
```

Polling fallback (no webhooks):

```tsx
import { useAssemblyStatusWithPolling } from "@transloadit/convex/react";
import { api } from "../convex/_generated/api";

const status = useAssemblyStatusWithPolling(
  api.transloadit.getAssemblyStatus,
  api.transloadit.refreshAssembly,
  assemblyId,
  { pollIntervalMs: 5000, stopOnTerminal: true },
);
```

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

Uppy/Tus wiring:

```ts
import { buildTusUploadConfig } from "@transloadit/convex";

const { endpoint, metadata } = buildTusUploadConfig(assembly.data, file, {
  fieldName: "file",
});
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
