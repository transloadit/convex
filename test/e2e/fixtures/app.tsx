import {
  useAssemblyStatus,
  useTransloaditFiles,
  useTransloaditUpload,
} from "@transloadit/convex/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

const api = {
  transloadit: {
    generateUploadParams: "generateUploadParams",
    getAssemblyStatus: "getAssemblyStatus",
    listResults: "listResults",
  },
};

const baseUrl = globalThis.location.origin;

globalThis.__convexAction = async (name: string, args: unknown) => {
  const response = await fetch(`${baseUrl}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args: args ?? {} }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Action ${name} failed: ${response.status} ${text}`);
  }

  return response.json();
};

globalThis.__convexQuery = async (name: string, args: unknown) => {
  const response = await fetch(`${baseUrl}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args: args ?? {} }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Query ${name} failed: ${response.status} ${text}`);
  }

  return response.json();
};

function App() {
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const { upload, isUploading, progress, error } = useTransloaditUpload(
    api.transloadit.generateUploadParams,
  );

  const status = useAssemblyStatus(
    api.transloadit.getAssemblyStatus,
    assemblyId ?? "",
  );
  const results = useTransloaditFiles(api.transloadit.listResults, {
    assemblyId: assemblyId ?? "",
  });

  const handleUpload = async (file: File) => {
    const notifyUrl = (
      globalThis as typeof globalThis & {
        __notifyUrl?: string;
      }
    ).__notifyUrl;
    if (!notifyUrl) {
      setConfigError("Missing notifyUrl");
      return;
    }

    const response = await upload(file, {
      notifyUrl,
    });

    const created = response.assembly_id ?? response.assemblyId;
    if (typeof created === "string") {
      setAssemblyId(created);
    }
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Transloadit + Convex E2E</h1>
      <input
        type="file"
        data-testid="file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleUpload(file);
          }
        }}
      />
      {isUploading && (
        <p data-testid="upload-progress">Uploading: {progress}%</p>
      )}
      {error && <p data-testid="upload-error">{error.message}</p>}
      {configError && <p data-testid="config-error">{configError}</p>}

      {assemblyId && (
        <section>
          <h2>Assembly</h2>
          <p data-testid="assembly-id">ID: {assemblyId}</p>
          <p data-testid="assembly-status">Status: {status?.ok ?? "pending"}</p>
        </section>
      )}

      {results && results.length > 0 && (
        <section>
          <h2>Results</h2>
          <pre data-testid="results-json">
            {JSON.stringify(results, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
