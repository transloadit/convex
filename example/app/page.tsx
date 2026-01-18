"use client";

import Uppy from "@uppy/core";
import { Dashboard } from "@uppy/react";
import Tus from "@uppy/tus";
import { useEffect, useMemo, useState } from "react";
import { weddingStepNames } from "../lib/transloadit";

type AssemblyResponse = {
  assemblyId: string;
  data: Record<string, unknown>;
};

type AssemblyStatus = {
  ok?: string;
};

type AssemblyResult = {
  _id?: string;
  sslUrl?: string;
  name?: string;
  mime?: string;
  stepName?: string;
};

const getAssemblyUrls = (data: Record<string, unknown>) => {
  const tusUrl =
    (typeof data.tus_url === "string" && data.tus_url) ||
    (typeof data.tusUrl === "string" && data.tusUrl) ||
    "";
  const assemblyUrl =
    (typeof data.assembly_ssl_url === "string" && data.assembly_ssl_url) ||
    (typeof data.assembly_url === "string" && data.assembly_url) ||
    (typeof data.assemblyUrl === "string" && data.assemblyUrl) ||
    "";
  return { tusUrl, assemblyUrl };
};

export default function WeddingUploads() {
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [results, setResults] = useState<AssemblyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uppy = useMemo(
    () =>
      new Uppy({
        autoProceed: false,
        restrictions: {
          allowedFileTypes: ["image/*", "video/*"],
          maxNumberOfFiles: 12,
        },
      }).use(Tus, { endpoint: "" }),
    [],
  );

  useEffect(() => {
    return () => {
      uppy.close();
    };
  }, [uppy]);

  const refreshResults = async (id: string, refresh = false) => {
    const params = new URLSearchParams({ assemblyId: id });
    if (refresh) params.set("refresh", "1");
    const response = await fetch(`/api/assemblies?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Failed to load assembly status");
    }
    const data = (await response.json()) as {
      status: AssemblyStatus | null;
      results: AssemblyResult[];
    };
    setStatus(data.status?.ok ?? "pending");
    setResults(data.results ?? []);
  };

  const startUpload = async () => {
    setError(null);
    const files = uppy.getFiles();
    if (!files.length) {
      setError("Select at least one image or video.");
      return;
    }

    setIsUploading(true);
    try {
      const response = await fetch("/api/assemblies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileCount: files.length, guestName: "Guest" }),
      });
      if (!response.ok) {
        throw new Error("Failed to create assembly");
      }
      const assembly = (await response.json()) as AssemblyResponse;
      setAssemblyId(assembly.assemblyId);

      const { tusUrl, assemblyUrl } = getAssemblyUrls(assembly.data);
      if (!tusUrl || !assemblyUrl) {
        throw new Error("Missing tus_url or assembly_url in response");
      }

      const tus = uppy.getPlugin("Tus");
      if (tus) {
        tus.setOptions({ endpoint: tusUrl });
      }

      for (const file of files) {
        uppy.setFileMeta(file.id, {
          assembly_url: assemblyUrl,
          fieldname: "file",
        });
      }

      await uppy.upload();
      await refreshResults(assembly.assemblyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (!assemblyId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        if (!cancelled) {
          await refreshResults(assemblyId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Refresh failed");
        }
      }
    };
    void poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [assemblyId]);

  return (
    <main className="page">
      <section className="panel">
        <h1 className="headline">Eden & Nico Wedding Gallery</h1>
        <p className="subhead">
          Share your favorite moments — drop photos and short clips below and
          we’ll add them to the live gallery.
        </p>
        <div data-testid="uppy-dashboard">
          <Dashboard
            uppy={uppy}
            height={360}
            width="100%"
            proudlyDisplayPoweredByUppy={false}
            note="Add a mix of photos and short videos."
          />
        </div>
        <div className="cta">
          <button
            className="button"
            type="button"
            onClick={() => void startUpload()}
            disabled={isUploading}
            data-testid="start-upload"
          >
            {isUploading ? "Uploading…" : "Upload to the gallery"}
          </button>
        </div>
        {error && (
          <p className="status" data-testid="upload-error">
            {error}
          </p>
        )}
        {assemblyId && (
          <div className="status">
            <p data-testid="assembly-id">ID: {assemblyId}</p>
            <p data-testid="assembly-status">Status: {status}</p>
          </div>
        )}
      </section>
      <section className="panel">
        <h2 className="headline">Live gallery</h2>
        <p className="subhead">
          Curated highlights from {weddingStepNames.image} and{" "}
          {weddingStepNames.video}.
        </p>
        {results.length === 0 ? (
          <p className="status" data-testid="gallery-empty">
            Uploads will appear here once processing completes.
          </p>
        ) : (
          <div className="gallery" data-testid="gallery">
            {results.map((item) => {
              const key =
                item._id ||
                item.sslUrl ||
                item.name ||
                Math.random().toString();
              const mime = item.mime ?? "";
              const isVideo = mime.startsWith("video");
              return (
                <div className="card" key={key}>
                  {item.sslUrl ? (
                    isVideo ? (
                      // biome-ignore lint/a11y/useMediaCaption: demo clips have no caption tracks
                      <video src={item.sslUrl} controls />
                    ) : (
                      <img src={item.sslUrl} alt={item.name ?? "Uploaded"} />
                    )
                  ) : (
                    <div className="status">Result pending</div>
                  )}
                  <div className="meta">
                    <div>{item.name ?? "Untitled"}</div>
                    <div>{item.stepName ?? "processed"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
