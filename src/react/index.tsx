import { useAction, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { parseAssemblyUrls } from "../shared/assemblyUrls.ts";

export type CreateAssemblyFn = FunctionReference<
  "action",
  "public",
  {
    templateId?: string;
    steps?: unknown;
    fields?: unknown;
    notifyUrl?: string;
    numExpectedUploadFiles?: number;
    expires?: string;
    additionalParams?: unknown;
    userId?: string;
  },
  { assemblyId: string; data: Record<string, unknown> }
>;

export type CreateAssemblyArgs = {
  templateId?: string;
  steps?: unknown;
  fields?: unknown;
  notifyUrl?: string;
  numExpectedUploadFiles?: number;
  expires?: string;
  additionalParams?: unknown;
  userId?: string;
};

export type CreateAssemblyResponse = {
  assemblyId: string;
  data: Record<string, unknown>;
};

export type CreateAssemblyHandler = (
  args: CreateAssemblyArgs,
) => Promise<CreateAssemblyResponse>;

export type GetAssemblyStatusFn = FunctionReference<
  "query",
  "public",
  { assemblyId: string },
  unknown
>;

export type ListResultsFn = FunctionReference<
  "query",
  "public",
  { assemblyId: string; stepName?: string; limit?: number },
  Array<unknown>
>;

export type RefreshAssemblyFn = FunctionReference<
  "action",
  "public",
  { assemblyId: string },
  { assemblyId: string; ok?: string; status?: string; resultCount: number }
>;

export interface UploadOptions {
  templateId?: string;
  steps?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  notifyUrl?: string;
  numExpectedUploadFiles?: number;
  expires?: string;
  additionalParams?: Record<string, unknown>;
  userId?: string;
}

export interface UploadState {
  isUploading: boolean;
  progress: number;
  error: Error | null;
}

export interface TusUploadOptions extends UploadOptions {
  metadata?: Record<string, string>;
  fieldName?: string;
  chunkSize?: number;
  retryDelays?: number[];
  onShouldRetry?: (error: unknown, retryAttempt: number) => boolean;
  rateLimitRetryDelays?: number[];
  overridePatchMethod?: boolean;
  uploadDataDuringCreation?: boolean;
  storeFingerprintForResuming?: boolean;
  removeFingerprintOnSuccess?: boolean;
  onProgress?: (progress: number) => void;
  onAssemblyCreated?: (assembly: {
    assemblyId: string;
    data: Record<string, unknown>;
  }) => void;
}

export type TusUploadEvents = {
  onStateChange?: (state: UploadState) => void;
};

export async function uploadWithTransloaditTus(
  createAssembly: CreateAssemblyHandler,
  file: File,
  options: TusUploadOptions,
  events: TusUploadEvents = {},
): Promise<CreateAssemblyResponse> {
  let currentState: UploadState = {
    isUploading: true,
    progress: 0,
    error: null,
  };

  const emitState = (next: UploadState) => {
    currentState = next;
    events.onStateChange?.(next);
  };

  emitState(currentState);

  try {
    const assembly = await createAssembly({
      templateId: options.templateId,
      steps: options.steps,
      fields: options.fields,
      notifyUrl: options.notifyUrl,
      numExpectedUploadFiles: options.numExpectedUploadFiles ?? 1,
      expires: options.expires,
      additionalParams: options.additionalParams,
      userId: options.userId,
    });

    const data = assembly.data as Record<string, unknown>;
    options.onAssemblyCreated?.(assembly);
    const { tusUrl, assemblyUrl } = parseAssemblyUrls(data);

    if (!tusUrl) {
      throw new Error(
        "Transloadit response missing tus_url for resumable upload",
      );
    }

    if (!assemblyUrl) {
      throw new Error(
        "Transloadit response missing assembly_url for resumable upload",
      );
    }

    const metadata: Record<string, string> = {
      filename: file.name,
      ...options.metadata,
    };
    if (file.type) {
      metadata.filetype = file.type;
    }
    if (!metadata.fieldname) {
      metadata.fieldname = options.fieldName ?? "file";
    }
    if (!metadata.assembly_url) {
      metadata.assembly_url = assemblyUrl;
    }

    type RetryError = {
      originalResponse?: {
        getStatus?: () => number;
        getHeader?: (header: string) => string | undefined;
      } | null;
    };

    const getStatus = (error: RetryError) =>
      error.originalResponse?.getStatus &&
      typeof error.originalResponse.getStatus === "function"
        ? error.originalResponse.getStatus()
        : 0;

    const retryDelays = options.retryDelays
      ? [...options.retryDelays]
      : [1000, 5000, 15000, 30000];
    const rateLimitRetryDelays = options.rateLimitRetryDelays
      ? [...options.rateLimitRetryDelays]
      : [20_000, 40_000, 80_000];

    const shouldRetry = (error: RetryError) => {
      const status = getStatus(error);
      if (!status) return true;
      if (status === 409 || status === 423) return true;
      return status < 400 || status >= 500;
    };

    let uploadUrl: string | null = null;
    let rateLimitAttempt = 0;

    const runUpload = () =>
      new Promise<void>((resolve, reject) => {
        let uploader: Upload;
        const uploadOptions: ConstructorParameters<typeof Upload>[1] = {
          endpoint: tusUrl,
          metadata,
          retryDelays,
          uploadDataDuringCreation: options.uploadDataDuringCreation ?? false,
          onUploadUrlAvailable: () => {
            uploadUrl = uploader.url;
          },
          onShouldRetry: (error, retryAttempt) =>
            options.onShouldRetry?.(error, retryAttempt) ?? shouldRetry(error),
          onProgress: (bytesUploaded, bytesTotal) => {
            const progress = Math.round((bytesUploaded / bytesTotal) * 100);
            emitState({ isUploading: true, progress, error: null });
            options.onProgress?.(progress);
          },
          onError: (error) => {
            reject(error);
          },
          onSuccess: () => {
            resolve();
          },
        };

        if (options.chunkSize !== undefined) {
          uploadOptions.chunkSize = options.chunkSize;
        }
        if (uploadUrl) {
          uploadOptions.uploadUrl = uploadUrl;
        }
        if (options.overridePatchMethod !== undefined) {
          uploadOptions.overridePatchMethod = options.overridePatchMethod;
        }
        if (options.storeFingerprintForResuming !== undefined) {
          uploadOptions.storeFingerprintForResuming =
            options.storeFingerprintForResuming;
        }
        if (options.removeFingerprintOnSuccess !== undefined) {
          uploadOptions.removeFingerprintOnSuccess =
            options.removeFingerprintOnSuccess;
        }

        uploader = new Upload(file, uploadOptions);

        uploader.start();
      });

    while (true) {
      try {
        await runUpload();
        break;
      } catch (error) {
        const status = getStatus(error as RetryError);
        if (status === 429 && rateLimitAttempt < rateLimitRetryDelays.length) {
          const delay = rateLimitRetryDelays[rateLimitAttempt] ?? 0;
          rateLimitAttempt += 1;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    emitState({ isUploading: false, progress: 100, error: null });
    return assembly;
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Upload failed");
    emitState({ isUploading: false, progress: 0, error: err });
    throw err;
  }
}

export function useTransloaditTusUpload(createAssembly: CreateAssemblyFn) {
  const create = useAction(createAssembly);
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  const upload = useCallback(
    async (file: File, options: TusUploadOptions) =>
      uploadWithTransloaditTus(create, file, options, {
        onStateChange: setState,
      }),
    [create],
  );

  const reset = useCallback(() => {
    setState({ isUploading: false, progress: 0, error: null });
  }, []);

  return useMemo(
    () => ({
      upload,
      reset,
      isUploading: state.isUploading,
      progress: state.progress,
      error: state.error,
    }),
    [state.error, state.isUploading, state.progress, upload, reset],
  );
}

export function useAssemblyStatus(
  getStatus: GetAssemblyStatusFn,
  assemblyId: string,
) {
  return useQuery(getStatus, { assemblyId });
}

export function useAssemblyStatusWithPolling(
  getStatus: GetAssemblyStatusFn,
  refreshAssembly: RefreshAssemblyFn,
  assemblyId: string,
  options?: { pollIntervalMs?: number; stopOnTerminal?: boolean },
) {
  const status = useQuery(getStatus, { assemblyId });
  const refresh = useAction(refreshAssembly);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!assemblyId) return;
    const intervalMs = options?.pollIntervalMs ?? 5000;
    if (intervalMs <= 0) return;

    const isTerminal = () => {
      if (!options?.stopOnTerminal) return false;
      const current = statusRef.current;
      if (!current || typeof current !== "object") return false;
      const ok =
        "ok" in current && typeof current.ok === "string" ? current.ok : "";
      return (
        ok === "ASSEMBLY_COMPLETED" ||
        ok === "ASSEMBLY_FAILED" ||
        ok === "ASSEMBLY_CANCELED"
      );
    };

    if (isTerminal()) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (isTerminal()) {
        if (intervalId) clearInterval(intervalId);
        cancelled = true;
        return;
      }
      await refresh({ assemblyId });
    };

    intervalId = setInterval(() => {
      void tick();
    }, intervalMs);
    void tick();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [assemblyId, options?.pollIntervalMs, options?.stopOnTerminal, refresh]);

  return status;
}

export function useTransloaditFiles(
  listResults: ListResultsFn,
  args: { assemblyId: string; stepName?: string; limit?: number },
) {
  return useQuery(listResults, args);
}
