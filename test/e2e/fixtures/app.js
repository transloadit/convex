import {
  useAssemblyStatus,
  useTransloaditFiles,
  useTransloaditUpload,
} from "@transloadit/convex/react";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

const api = {
  transloadit: {
    generateUploadParams: "generateUploadParams",
    getAssemblyStatus: "getAssemblyStatus",
    listResults: "listResults",
  },
};

const baseUrl = globalThis.location.origin;

globalThis.__convexAction = async (name, args) => {
  const response = await fetch(`${baseUrl}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Action ${name} failed: ${response.status} ${text}`);
  }

  return response.json();
};

globalThis.__convexQuery = async (name, args) => {
  const response = await fetch(`${baseUrl}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Query ${name} failed: ${response.status} ${text}`);
  }

  return response.json();
};

function App() {
  const [assemblyId, setAssemblyId] = useState(null);
  const [configError, setConfigError] = useState(null);
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

  const handleUpload = async (file) => {
    const notifyUrl = globalThis.__notifyUrl;
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

  return React.createElement(
    "div",
    { style: { fontFamily: "system-ui", padding: 24 } },
    React.createElement("h1", null, "Transloadit + Convex E2E"),
    React.createElement("input", {
      type: "file",
      "data-testid": "file-input",
      onChange: (event) => {
        const file = event.target.files?.[0];
        if (file) {
          void handleUpload(file);
        }
      },
    }),
    isUploading
      ? React.createElement(
          "p",
          { "data-testid": "upload-progress" },
          `Uploading: ${progress}%`,
        )
      : null,
    error
      ? React.createElement(
          "p",
          { "data-testid": "upload-error" },
          error.message,
        )
      : null,
    configError
      ? React.createElement("p", { "data-testid": "config-error" }, configError)
      : null,
    assemblyId
      ? React.createElement(
          "section",
          null,
          React.createElement("h2", null, "Assembly"),
          React.createElement(
            "p",
            { "data-testid": "assembly-id" },
            `ID: ${assemblyId}`,
          ),
          React.createElement(
            "p",
            { "data-testid": "assembly-status" },
            `Status: ${status?.ok ?? "pending"}`,
          ),
        )
      : null,
    results && results.length > 0
      ? React.createElement(
          "section",
          null,
          React.createElement("h2", null, "Results"),
          React.createElement(
            "pre",
            { "data-testid": "results-json" },
            JSON.stringify(results, null, 2),
          ),
        )
      : null,
  );
}

const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
