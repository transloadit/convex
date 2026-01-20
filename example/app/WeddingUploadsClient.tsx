"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildTusUploadConfig, weddingStepNames } from "../lib/transloadit";
import { Providers } from "./providers";

const Dashboard = dynamic(() => import("@uppy/react/dashboard"), {
  ssr: false,
});

type AssemblyResponse = {
  assemblyId: string;
  data: Record<string, unknown>;
  params?: Record<string, unknown>;
};

type AssemblyStatus = {
  ok?: string;
};

type AssemblyResult = {
  assemblyId?: string;
  _id?: string;
  resultId?: string;
  sslUrl?: string;
  name?: string;
  mime?: string;
  stepName?: string;
  createdAt?: number;
  raw?: Record<string, unknown>;
};

type AssemblySummary = {
  _id?: string;
  assemblyId?: string;
  createdAt?: number;
  fields?: Record<string, unknown>;
};

type Toast = {
  id: string;
  message: string;
};

type UploadResult = {
  successful?: Array<{ id: string; name?: string }>;
  failed?: Array<{
    id: string;
    name?: string;
    error?: { message?: string };
  }>;
};

type UploadStage =
  | "idle"
  | "creating"
  | "uploading"
  | "processing"
  | "complete"
  | "error";

const retentionHours = Number.parseFloat(
  process.env.NEXT_PUBLIC_GALLERY_RETENTION_HOURS ?? "24",
);
const retentionMs =
  Number.isFinite(retentionHours) && retentionHours > 0
    ? retentionHours * 60 * 60 * 1000
    : Number.POSITIVE_INFINITY;
const retentionLabel =
  retentionMs === Number.POSITIVE_INFINITY ? "all time" : `${retentionHours}h`;

const filterResults = (results: AssemblyResult[]) => {
  if (retentionMs === Number.POSITIVE_INFINITY) return results;
  return results.filter((item) => {
    if (typeof item.createdAt !== "number") return true;
    return Date.now() - item.createdAt < retentionMs;
  });
};

const stageRank: Record<UploadStage, number> = {
  idle: 0,
  creating: 1,
  uploading: 2,
  processing: 3,
  complete: 4,
  error: 5,
};

const shouldAdvanceStage = (current: UploadStage, next: UploadStage) =>
  stageRank[next] >= stageRank[current];

const terminalErrorStatuses = new Set([
  "ASSEMBLY_FAILED",
  "ASSEMBLY_CANCELED",
  "ASSEMBLY_ABORTED",
  "ASSEMBLY_EXPIRED",
  "REQUEST_ABORTED",
]);

const deriveStageFromStatus = (status: string | null | undefined) => {
  if (!status) return null;
  if (status === "ASSEMBLY_COMPLETED") return "complete";
  if (status === "ASSEMBLY_EXECUTING") return "processing";
  if (status === "ASSEMBLY_UPLOADING") return "uploading";
  if (terminalErrorStatuses.has(status)) return "error";
  return null;
};

const getRawString = (result: AssemblyResult, key: string) => {
  if (!result.raw) return null;
  const value = result.raw[key];
  return typeof value === "string" ? value : null;
};

const getOriginalKey = (result: AssemblyResult) =>
  getRawString(result, "original_id") ??
  getRawString(result, "original_basename") ??
  result.name ??
  result.resultId ??
  result._id ??
  null;

const terminalStatuses = new Set([
  "ASSEMBLY_COMPLETED",
  "ASSEMBLY_FAILED",
  "ASSEMBLY_CANCELED",
  "ASSEMBLY_ABORTED",
]);

const isTerminalStatus = (status: string | null | undefined) =>
  status ? terminalStatuses.has(status) : false;

const useAssemblyPoller = ({
  assemblyId,
  status,
  refresh,
  intervalMs,
  onError,
  shouldContinue,
}: {
  assemblyId: string | null;
  status: string | null | undefined;
  refresh: () => Promise<void>;
  intervalMs: number;
  onError?: (error: Error) => void;
  shouldContinue?: () => boolean;
}) => {
  useEffect(() => {
    if (!assemblyId) return;
    const shouldKeepPolling = () => {
      if (!isTerminalStatus(status)) return true;
      return shouldContinue?.() ?? false;
    };
    if (!shouldKeepPolling()) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      if (!shouldKeepPolling()) return;
      try {
        await refresh();
      } catch (error) {
        if (!cancelled) {
          const resolved =
            error instanceof Error ? error : new Error("Refresh failed");
          onError?.(resolved);
        }
      }
    };
    void poll();
    const interval = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [assemblyId, intervalMs, onError, refresh, shouldContinue, status]);
};

const UploadTimeline = ({ stage }: { stage: UploadStage }) => {
  const steps: Array<{ stage: UploadStage; label: string }> = [
    { stage: "creating", label: "Assembly created" },
    { stage: "uploading", label: "Uploading files" },
    { stage: "processing", label: "Processing & storing" },
    { stage: "complete", label: "Gallery updated" },
  ];
  const currentRank = stageRank[stage];

  return (
    <div className="timeline" data-testid="upload-timeline">
      {steps.map((step) => {
        const isActive = currentRank >= stageRank[step.stage];
        const isCurrent = stage === step.stage;
        return (
          <div
            className={`timeline-step${isActive ? " active" : ""}${isCurrent ? " current" : ""}`}
            key={step.stage}
          >
            <span className="timeline-dot" />
            <span className="timeline-label">{step.label}</span>
          </div>
        );
      })}
      {stage === "error" && (
        <div className="timeline-error">Upload failed. Try again.</div>
      )}
    </div>
  );
};

const useWeddingUppy = () => {
  const [uppy] = useState(() =>
    new Uppy({
      autoProceed: false,
      restrictions: {
        allowedFileTypes: ["image/*", "video/*"],
        maxNumberOfFiles: 12,
      },
    }).use(Tus, { endpoint: "" }),
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as { __uppy?: Uppy }).__uppy = uppy;
    }
    return () => {
      // Avoid StrictMode dev cleanup nuking plugins on the shared instance.
      if (process.env.NODE_ENV === "production") {
        uppy.destroy();
      }
    };
  }, [uppy]);

  return uppy;
};

const useUploadToasts = (assemblies: AssemblySummary[] | undefined) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!assemblies) return;
    if (!initialized.current) {
      assemblies.forEach((assembly) => {
        const id =
          assembly._id ?? assembly.assemblyId ?? `${assembly.createdAt ?? 0}`;
        seen.current.add(id);
      });
      initialized.current = true;
      return;
    }
    const next = [...assemblies].reverse();
    next.forEach((assembly) => {
      const id =
        assembly._id ?? assembly.assemblyId ?? `${assembly.createdAt ?? 0}`;
      if (seen.current.has(id)) return;
      seen.current.add(id);

      const fields = assembly.fields ?? {};
      const guestName =
        typeof fields.guestName === "string" ? fields.guestName : "Guest";
      const fileCount =
        typeof fields.fileCount === "number" ? fields.fileCount : undefined;
      const message = fileCount
        ? `${guestName} uploaded ${fileCount} file${fileCount === 1 ? "" : "s"}`
        : `${guestName} uploaded new files`;

      setToasts((prev) => [...prev, { id, message }]);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
        timers.current.delete(id);
      }, 6000);
      timers.current.set(id, timer);
    });
  }, [assemblies]);

  return toasts;
};

const formatUploadFailure = (result: UploadResult) => {
  const failed = result.failed ?? [];
  if (failed.length === 0) return null;
  const summary = failed
    .map((file) => {
      const name = file.name ?? file.id;
      const message = file.error?.message ?? "Unknown error";
      return `${name}: ${message}`;
    })
    .join("; ");
  return `Upload failed (${failed.length} file${failed.length === 1 ? "" : "s"}). ${summary}`;
};

const createWeddingAssemblyRef = makeFunctionReference<
  "action",
  { fileCount: number; guestName?: string; uploadCode?: string },
  AssemblyResponse
>("wedding:createWeddingAssembly");
const listAssembliesRef = makeFunctionReference<
  "query",
  { status?: string; userId?: string; limit?: number },
  AssemblySummary[]
>("transloadit:listAssemblies");
const listResultsRef = makeFunctionReference<
  "query",
  { assemblyId: string; stepName?: string; limit?: number },
  AssemblyResult[]
>("transloadit:listResults");
const getAssemblyStatusRef = makeFunctionReference<
  "query",
  { assemblyId: string },
  AssemblyStatus | null
>("transloadit:getAssemblyStatus");
const refreshAssemblyRef = makeFunctionReference<
  "action",
  { assemblyId: string },
  { assemblyId: string; resultCount: number; ok?: string; status?: string }
>("transloadit:refreshAssembly");

const Gallery = ({ results }: { results: AssemblyResult[] }) => {
  const visibleResults = filterResults(results);
  const thumbStep = weddingStepNames.videoThumbs;
  const imageStep = weddingStepNames.image;
  const videoStep = weddingStepNames.video;
  const thumbByOriginal = new Map<string, string>();

  for (const result of visibleResults) {
    if (result.stepName !== thumbStep) continue;
    if (!result.sslUrl) continue;
    const key = getOriginalKey(result);
    if (!key) continue;
    thumbByOriginal.set(key, result.sslUrl);
  }

  const galleryItems = visibleResults.filter((result) => {
    const step = result.stepName;
    return step === imageStep || step === videoStep;
  });

  return galleryItems.length === 0 ? (
    <p className="status" data-testid="gallery-empty">
      Uploads will appear here once processing completes.
    </p>
  ) : (
    <div className="gallery" data-testid="gallery">
      {galleryItems.map((item) => {
        const key =
          item._id ||
          item.sslUrl ||
          item.name ||
          `${item.assemblyId ?? "assembly"}-${item.stepName ?? "step"}-${item.createdAt ?? 0}`;
        const mime = item.mime ?? "";
        const isVideo = mime.startsWith("video");
        const originalKey = getOriginalKey(item);
        const posterUrl =
          isVideo && originalKey ? thumbByOriginal.get(originalKey) : null;
        const badge = isVideo ? "Encoded video" : "Resized image";

        return (
          <div className="card" data-assembly-id={item.assemblyId} key={key}>
            <div className="badge">{badge}</div>
            {item.sslUrl ? (
              isVideo ? (
                // biome-ignore lint/a11y/useMediaCaption: demo clips have no caption tracks
                <video
                  src={item.sslUrl}
                  controls
                  poster={posterUrl ?? undefined}
                />
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
  );
};

const LocalWeddingUploads = () => {
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [assemblyParams, setAssemblyParams] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [results, setResults] = useState<AssemblyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [guestName, setGuestName] = useState("Guest");
  const [uploadCode, setUploadCode] = useState("");
  const uppy = useWeddingUppy();

  const refreshResults = useCallback(async (id: string, refresh = false) => {
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
  }, []);

  const startUpload = async () => {
    setError(null);
    setStage("creating");
    const files = uppy.getFiles();
    if (!files.length) {
      setError("Select at least one image or video.");
      setStage("error");
      return;
    }

    setIsUploading(true);
    try {
      const response = await fetch("/api/assemblies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileCount: files.length,
          guestName,
          uploadCode,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to create assembly");
      }
      const assembly = (await response.json()) as AssemblyResponse;
      setAssemblyId(assembly.assemblyId);
      setAssemblyParams(assembly.params ?? null);
      setStage("uploading");

      const tus = uppy.getPlugin("Tus");
      let tusEndpoint: string | null = null;
      for (const file of files) {
        const { endpoint, metadata } = buildTusUploadConfig(
          assembly.data,
          file.data as File,
          { fieldName: "file" },
        );
        if (!tusEndpoint) {
          tusEndpoint = endpoint;
        }
        uppy.setFileMeta(file.id, metadata);
        uppy.setFileState(file.id, {
          tus: {
            ...(file.tus ?? {}),
            endpoint,
            addRequestId: true,
          },
        });
      }
      if (tus && "setOptions" in tus && tusEndpoint) {
        tus.setOptions({ endpoint: tusEndpoint, addRequestId: true });
      }

      const result = (await uppy.upload()) as UploadResult;
      const failure = formatUploadFailure(result);
      if (failure) {
        throw new Error(failure);
      }
      setStage("processing");
      await refreshResults(assembly.assemblyId, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      setStage("error");
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    const nextStage = deriveStageFromStatus(status);
    if (!nextStage) return;
    if (shouldAdvanceStage(stage, nextStage)) {
      setStage(nextStage);
    }
  }, [stage, status]);

  const refreshLocal = useCallback(() => {
    if (!assemblyId) return Promise.resolve();
    return refreshResults(assemblyId, true);
  }, [assemblyId, refreshResults]);
  const shouldContinueLocal = useCallback(
    () => results.length === 0,
    [results.length],
  );

  useAssemblyPoller({
    assemblyId,
    status,
    intervalMs: 4000,
    refresh: refreshLocal,
    onError: (err) => setError(err.message),
    shouldContinue: shouldContinueLocal,
  });

  return (
    <WeddingLayout
      uppy={uppy}
      guestName={guestName}
      onGuestNameChange={setGuestName}
      uploadCode={uploadCode}
      onUploadCodeChange={setUploadCode}
      isUploading={isUploading}
      onUpload={() => void startUpload()}
      error={error}
      assemblyId={assemblyId}
      assemblyParams={assemblyParams}
      status={status}
      stage={stage}
    >
      <Gallery results={results} />
    </WeddingLayout>
  );
};

const CloudWeddingUploads = () => {
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [assemblyParams, setAssemblyParams] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [guestName, setGuestName] = useState("Guest");
  const [uploadCode, setUploadCode] = useState("");
  const uppy = useWeddingUppy();
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const createWeddingAssembly = useAction(createWeddingAssemblyRef);
  const refreshAssembly = useAction(refreshAssemblyRef);
  const status = useQuery(
    getAssemblyStatusRef,
    assemblyId ? { assemblyId } : "skip",
  );
  const results = useQuery(
    listResultsRef,
    assemblyId ? { assemblyId } : "skip",
  );
  const assemblies = useQuery(listAssembliesRef, {
    status: "ASSEMBLY_COMPLETED",
    limit: 12,
  });
  const toasts = useUploadToasts(assemblies ?? undefined);

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    let cancelled = false;
    void signIn("anonymous").catch((error) => {
      if (cancelled) return;
      console.warn("Convex auth sign-in failed", error);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, signIn]);

  const refreshCloud = useCallback(() => {
    if (!assemblyId) return Promise.resolve();
    return refreshAssembly({ assemblyId });
  }, [assemblyId, refreshAssembly]);
  const shouldContinueCloud = useCallback(
    () => (results?.length ?? 0) === 0,
    [results?.length],
  );

  useAssemblyPoller({
    assemblyId,
    status: status?.ok ?? null,
    intervalMs: 8000,
    refresh: refreshCloud,
    onError: (error) => {
      console.warn("Refresh assembly failed", error);
    },
    shouldContinue: shouldContinueCloud,
  });

  useEffect(() => {
    const nextStage = deriveStageFromStatus(status?.ok ?? null);
    if (!nextStage) return;
    if (shouldAdvanceStage(stage, nextStage)) {
      setStage(nextStage);
    }
  }, [stage, status?.ok]);

  const startUpload = async () => {
    setError(null);
    setStage("creating");
    const files = uppy.getFiles();
    if (!files.length) {
      setError("Select at least one image or video.");
      setStage("error");
      return;
    }
    if (!isAuthenticated) {
      setError("Signing you in...");
      setStage("error");
      return;
    }

    setIsUploading(true);
    try {
      const assembly = await createWeddingAssembly({
        fileCount: files.length,
        guestName,
        uploadCode,
      });
      setAssemblyId(assembly.assemblyId);
      setAssemblyParams(assembly.params ?? null);
      setStage("uploading");

      const tus = uppy.getPlugin("Tus");
      let tusEndpoint: string | null = null;
      for (const file of files) {
        const { endpoint, metadata } = buildTusUploadConfig(
          assembly.data,
          file.data as File,
          { fieldName: "file" },
        );
        if (!tusEndpoint) {
          tusEndpoint = endpoint;
        }
        uppy.setFileMeta(file.id, metadata);
        uppy.setFileState(file.id, {
          tus: {
            ...(file.tus ?? {}),
            endpoint,
            addRequestId: true,
          },
        });
      }
      if (tus && "setOptions" in tus && tusEndpoint) {
        tus.setOptions({ endpoint: tusEndpoint, addRequestId: true });
      }

      const result = (await uppy.upload()) as UploadResult;
      const failure = formatUploadFailure(result);
      if (failure) {
        throw new Error(failure);
      }
      setStage("processing");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      setStage("error");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <WeddingLayout
      uppy={uppy}
      guestName={guestName}
      onGuestNameChange={setGuestName}
      uploadCode={uploadCode}
      onUploadCodeChange={setUploadCode}
      isUploading={isUploading}
      onUpload={() => void startUpload()}
      error={error}
      assemblyId={assemblyId}
      status={status?.ok ?? "pending"}
      stage={stage}
      toasts={toasts}
      authState={
        isLoading ? "loading" : isAuthenticated ? "authenticated" : "guest"
      }
      assemblyParams={assemblyParams}
    >
      <Gallery results={results ?? []} />
    </WeddingLayout>
  );
};

const WeddingLayout = ({
  uppy,
  guestName,
  onGuestNameChange,
  uploadCode,
  onUploadCodeChange,
  isUploading,
  onUpload,
  error,
  assemblyId,
  assemblyParams,
  status,
  stage,
  toasts,
  authState,
  children,
}: {
  uppy: Uppy;
  guestName: string;
  onGuestNameChange: (value: string) => void;
  uploadCode: string;
  onUploadCodeChange: (value: string) => void;
  isUploading: boolean;
  onUpload: () => void;
  error: string | null;
  assemblyId: string | null;
  assemblyParams: Record<string, unknown> | null;
  status: string;
  stage: UploadStage;
  toasts?: Toast[];
  authState?: "loading" | "authenticated" | "guest";
  children: React.ReactNode;
}) => {
  const [copied, setCopied] = useState(false);
  const payloadText = assemblyParams
    ? JSON.stringify(assemblyParams, null, 2)
    : null;

  const handleCopy = async () => {
    if (!payloadText) return;
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(payloadText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main
      className="page"
      data-auth-state={authState ?? "local"}
      suppressHydrationWarning
    >
      <section className="panel">
        <h1 className="headline">Eden & Nico Wedding Gallery</h1>
        <p className="subhead">
          Share your favorite moments — drop photos and short clips below and
          we’ll add them to the live gallery.
        </p>
        {authState && authState !== "authenticated" && (
          <p className="status" data-testid="auth-status">
            {authState === "loading"
              ? "Signing you in..."
              : "Signing you in as a guest."}
          </p>
        )}
        <label className="input">
          <span>Your name</span>
          <input
            value={guestName}
            onChange={(event) => onGuestNameChange(event.target.value)}
            placeholder="Guest"
          />
        </label>
        <label className="input">
          <span>Invite code</span>
          <input
            value={uploadCode}
            onChange={(event) => onUploadCodeChange(event.target.value)}
            placeholder="Optional if the couple shared one"
            type="password"
          />
        </label>
        <div data-testid="uppy-dashboard">
          <Dashboard
            uppy={uppy}
            height={360}
            width="100%"
            proudlyDisplayPoweredByUppy={false}
            hideUploadButton
            note={`Add photos/videos. Gallery shows ${retentionLabel} to limit spam.`}
          />
        </div>
        <div className="cta">
          <button
            className="button"
            type="button"
            onClick={onUpload}
            disabled={
              isUploading || (authState && authState !== "authenticated")
            }
            data-testid="start-upload"
          >
            {isUploading ? "Uploading…" : "Upload to the gallery"}
          </button>
        </div>
        <UploadTimeline stage={stage} />
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
        {payloadText && (
          <div className="payload-panel" data-testid="assembly-payload">
            <div className="payload-header">
              <span>createAssembly payload</span>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void handleCopy()}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="payload-code">{payloadText}</pre>
            <p className="payload-note">
              Secrets are redacted server-side before returning this payload.
            </p>
          </div>
        )}
      </section>
      <section className="panel">
        <h2 className="headline">Live gallery</h2>
        <p className="subhead">
          Curated highlights processed by Transloadit — resized images and
          encoded videos.
        </p>
        {children}
        <p className="status">
          Gallery shows the most recent uploads (set
          NEXT_PUBLIC_GALLERY_RETENTION_HOURS). Files are persisted in R2 via
          Transloadit’s Cloudflare store robot.
        </p>
      </section>
      {toasts && toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </main>
  );
};

export default function WeddingUploadsClient({
  convexUrl,
}: {
  convexUrl?: string | null;
}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [resolvedConvexUrl, setResolvedConvexUrl] = useState<string | null>(
    () => {
      if (convexUrl) return convexUrl;
      if (typeof window === "undefined") return null;
      const params = new URLSearchParams(window.location.search);
      return params.get("convexUrl");
    },
  );

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (convexUrl) {
      setResolvedConvexUrl(convexUrl);
      return;
    }
    if (resolvedConvexUrl) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("convexUrl");
    if (fromQuery) {
      setResolvedConvexUrl(fromQuery);
    }
  }, [convexUrl, resolvedConvexUrl]);
  if (!isHydrated) {
    return null;
  }
  const hasConvex = Boolean(resolvedConvexUrl);
  if (!hasConvex) {
    return <LocalWeddingUploads />;
  }

  return (
    <Providers convexUrl={resolvedConvexUrl ?? ""}>
      <CloudWeddingUploads />
    </Providers>
  );
}
