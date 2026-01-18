import { useAction, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload } from "tus-js-client";

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

export function useTransloaditTusUpload(createAssembly: CreateAssemblyFn) {
  const create = useAction(createAssembly);
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  const upload = useCallback(
    async (file: File, options: TusUploadOptions) => {
      setState({ isUploading: true, progress: 0, error: null });

      try {
        const assembly = await create({
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
        const tusUrl =
          (typeof data.tus_url === "string" && data.tus_url) ||
          (typeof data.tusUrl === "string" && data.tusUrl) ||
          "";

        if (!tusUrl) {
          throw new Error(
            "Transloadit response missing tus_url for resumable upload",
          );
        }

        const assemblyUrl =
          (typeof data.assembly_ssl_url === "string" &&
            data.assembly_ssl_url) ||
          (typeof data.assembly_url === "string" && data.assembly_url) ||
          (typeof data.assemblyUrl === "string" && data.assemblyUrl) ||
          "";

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
              uploadDataDuringCreation:
                options.uploadDataDuringCreation ?? false,
              onUploadUrlAvailable: () => {
                uploadUrl = uploader.url;
              },
              onShouldRetry: (error, retryAttempt) =>
                options.onShouldRetry?.(error, retryAttempt) ??
                shouldRetry(error),
              onProgress: (bytesUploaded, bytesTotal) => {
                const progress = Math.round((bytesUploaded / bytesTotal) * 100);
                setState((prev) => ({ ...prev, progress }));
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
            if (
              status === 429 &&
              rateLimitAttempt < rateLimitRetryDelays.length
            ) {
              const delay = rateLimitRetryDelays[rateLimitAttempt] ?? 0;
              rateLimitAttempt += 1;
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            throw error;
          }
        }

        setState({ isUploading: false, progress: 100, error: null });
        return assembly;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Upload failed");
        setState({ isUploading: false, progress: 0, error: err });
        throw err;
      }
    },
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

  useEffect(() => {
    if (!assemblyId) return;
    const intervalMs = options?.pollIntervalMs ?? 5000;
    if (intervalMs <= 0) return;

    const isTerminal = () => {
      if (!options?.stopOnTerminal) return false;
      if (!status || typeof status !== "object") return false;
      const ok =
        "ok" in status && typeof status.ok === "string" ? status.ok : "";
      return (
        ok === "ASSEMBLY_COMPLETED" ||
        ok === "ASSEMBLY_FAILED" ||
        ok === "ASSEMBLY_CANCELED"
      );
    };

    if (isTerminal()) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refresh({ assemblyId });
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    assemblyId,
    options?.pollIntervalMs,
    options?.stopOnTerminal,
    refresh,
    status,
  ]);

  return status;
}

export function useTransloaditFiles(
  listResults: ListResultsFn,
  args: { assemblyId: string; stepName?: string; limit?: number },
) {
  return useQuery(listResults, args);
}
