import {
  useAssemblyStatus,
  useTransloaditFiles,
  useTransloaditUpload,
} from "@transloadit/convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";

export default function App() {
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const templateId = import.meta.env.VITE_TRANSLOADIT_TEMPLATE_ID as
    | string
    | undefined;
  const notifyUrl = import.meta.env.VITE_TRANSLOADIT_NOTIFY_URL as
    | string
    | undefined;
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
    if (!templateId) {
      setConfigError("Missing VITE_TRANSLOADIT_TEMPLATE_ID");
      return;
    }

    const response = await upload(file, {
      templateId,
      notifyUrl,
    });
    const created = response.assembly_id ?? response.assemblyId;
    if (typeof created === "string") {
      setAssemblyId(created);
    }
  };

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Transloadit + Convex</h1>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleUpload(file);
          }
        }}
      />
      {isUploading && <p>Uploading: {progress}%</p>}
      {error && <p>{error.message}</p>}
      {configError && <p>{configError}</p>}

      {assemblyId && (
        <section>
          <h2>Assembly</h2>
          <p>ID: {assemblyId}</p>
          <p>Status: {status?.ok ?? "pending"}</p>
        </section>
      )}

      {results && results.length > 0 && (
        <section>
          <h2>Results</h2>
          <ul>
            {results.map((result) => {
              const entry = result as Record<string, unknown>;
              const key =
                (typeof entry.resultId === "string" && entry.resultId) ||
                (typeof entry._id === "string" && entry._id) ||
                (typeof entry.sslUrl === "string" && entry.sslUrl) ||
                JSON.stringify(entry);

              return <li key={key}>{JSON.stringify(result)}</li>;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
