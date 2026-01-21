import {
  type AssemblyStatus,
  isAssemblyTerminal,
} from "@transloadit/zod/v3/assemblyStatus";
import { useAction, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import {
  type AssemblyStage,
  getAssemblyStage,
  parseAssemblyStatus,
} from "../shared/assemblyUrls.ts";
import { pollAssembly } from "../shared/pollAssembly.ts";
import { buildTusUploadConfig } from "../shared/tusUpload.ts";

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

export type MultiFileTusUploadOptions = Omit<
  TusUploadOptions,
  "metadata" | "fieldName" | "onProgress"
> & {
  concurrency?: number;
  metadata?: Record<string, string> | ((file: File) => Record<string, string>);
  fieldName?: string | ((file: File) => string);
  onFileProgress?: (file: File, progress: number) => void;
  onFileComplete?: (file: File) => void;
  onFileError?: (file: File, error: Error) => void;
  onOverallProgress?: (progress: number) => void;
  onStateChange?: (state: UploadState) => void;
  failFast?: boolean;
  signal?: AbortSignal;
};

export type MultiFileTusUploadResult = {
  assemblyId: string;
  data: Record<string, unknown>;
  files: Array<{
    file: File;
    status: "success" | "error" | "canceled";
    error?: Error;
  }>;
};

export type MultiFileTusUploadController = {
  promise: Promise<MultiFileTusUploadResult>;
  cancel: () => void;
};

export type UppyTusState = {
  endpoint?: string;
  addRequestId?: boolean;
};

export type UppyFile = {
  id: string;
  data: File;
  tus?: UppyTusState;
};

export type UppyUploadResult = {
  successful?: Array<{ id: string; name?: string }>;
  failed?: Array<{ id: string; name?: string; error?: { message?: string } }>;
};

export type UppyLike = {
  getFiles: () => UppyFile[];
  setFileMeta: (fileId: string, metadata: Record<string, string>) => void;
  setFileState: (fileId: string, state: { tus?: UppyTusState }) => void;
  getPlugin: (name: string) =>
    | {
        setOptions?: (options: {
          endpoint?: string;
          addRequestId?: boolean;
        }) => void;
      }
    | undefined
    | null;
  upload: () => Promise<UppyUploadResult>;
};

export type UploadWithAssemblyOptions<TArgs extends { fileCount: number }> = {
  fileCount?: number;
  fieldName?: string;
  metadata?: Record<string, string>;
  addRequestId?: boolean;
  createAssemblyArgs?: Partial<TArgs>;
  onAssemblyCreated?: (assembly: {
    assemblyId: string;
    data: Record<string, unknown>;
  }) => void;
};

export type UploadWithAssemblyResult<TAssembly> = {
  assembly: TAssembly;
  uploadResult: UppyUploadResult;
};

export type UseTransloaditUploadOptions = {
  createAssembly: CreateAssemblyFn;
  getStatus: GetAssemblyStatusFn;
  listResults: ListResultsFn;
  refreshAssembly: RefreshAssemblyFn;
  pollIntervalMs?: number;
  stopOnTerminal?: boolean;
  shouldContinue?: () => boolean;
  onError?: (error: Error) => void;
};

export type UseTransloaditUploadResult = {
  upload: (
    files: File | File[] | FileList,
    options: MultiFileTusUploadOptions,
  ) => Promise<MultiFileTusUploadResult>;
  cancel: () => void;
  reset: () => void;
  isUploading: boolean;
  progress: number;
  error: Error | null;
  assemblyId: string | null;
  assemblyData: Record<string, unknown> | null;
  assembly: unknown;
  status: AssemblyStatus | null;
  results: Array<unknown> | undefined;
};

export type UseTransloaditUppyOptions<
  TArgs extends { fileCount: number },
  TAssembly extends { assemblyId: string; data: Record<string, unknown> },
> = {
  uppy: UppyLike;
  createAssembly: FunctionReference<"action", "public", TArgs, TAssembly>;
  getStatus: GetAssemblyStatusFn;
  listResults: ListResultsFn;
  refreshAssembly: RefreshAssemblyFn;
  pollIntervalMs?: number;
  shouldContinue?: () => boolean;
  onError?: (error: Error) => void;
  createAssemblyArgs?: Partial<TArgs>;
  fileCount?: number;
  fieldName?: string;
  metadata?: Record<string, string>;
  addRequestId?: boolean;
  onAssemblyCreated?: (assembly: TAssembly) => void;
  onUploadResult?: (result: UppyUploadResult) => void;
};

export type UseTransloaditUppyResult<TAssembly> = {
  startUpload: (
    overrides?: Partial<UploadWithAssemblyOptions<{ fileCount: number }>>,
  ) => Promise<UploadWithAssemblyResult<TAssembly>>;
  reset: () => void;
  isUploading: boolean;
  error: Error | null;
  assemblyId: string | null;
  assemblyData: Record<string, unknown> | null;
  assembly: unknown;
  status: AssemblyStatus | null;
  results: Array<unknown> | undefined;
  stage: AssemblyStage | "uploading" | "error" | null;
  uploadResult: UppyUploadResult | null;
};

export async function uploadWithAssembly<
  TArgs extends { fileCount: number },
  TAssembly extends { assemblyId: string; data: Record<string, unknown> },
>(
  createAssembly: (args: TArgs) => Promise<TAssembly>,
  uppy: UppyLike,
  options: UploadWithAssemblyOptions<TArgs>,
): Promise<UploadWithAssemblyResult<TAssembly>> {
  const files = uppy.getFiles();
  if (files.length === 0) {
    throw new Error("No files provided for upload");
  }

  const args = {
    ...(options.createAssemblyArgs ?? {}),
    fileCount: options.fileCount ?? files.length,
  } as TArgs;
  const assembly = await createAssembly(args);
  options.onAssemblyCreated?.(assembly);

  const tusPlugin = uppy.getPlugin("Tus");
  if (!tusPlugin) {
    throw new Error(
      'Uppy Tus plugin is required. Call uppy.use(Tus, { endpoint: "" }) before uploadWithAssembly.',
    );
  }
  let tusEndpoint: string | null = null;
  const addRequestId = options.addRequestId ?? true;

  for (const file of files) {
    const { endpoint, metadata } = buildTusUploadConfig(
      assembly.data,
      file.data,
      {
        fieldName: options.fieldName,
        metadata: options.metadata,
      },
    );
    if (!tusEndpoint) {
      tusEndpoint = endpoint;
    }
    uppy.setFileMeta(file.id, metadata);
    uppy.setFileState(file.id, {
      tus: {
        ...(file.tus ?? {}),
        endpoint,
        addRequestId,
      },
    });
  }

  if (tusPlugin && "setOptions" in tusPlugin && tusEndpoint) {
    tusPlugin.setOptions?.({ endpoint: tusEndpoint, addRequestId });
  }

  const uploadResult = await uppy.upload();
  return { assembly, uploadResult };
}

/**
 * Low-level tus upload helper. Prefer `useTransloaditUpload` for new code.
 */
/**
 * Low-level tus upload helper. Prefer `useTransloaditUpload` for new code.
 */
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
    const { endpoint, metadata } = buildTusUploadConfig(data, file, {
      fieldName: options.fieldName,
      metadata: options.metadata,
    });

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
          endpoint,
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

/**
 * @deprecated Prefer `useTransloaditUpload` (single + multi-file) for new code.
 */
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

/**
 * Low-level multi-file tus uploader. Prefer `useTransloaditUpload` for new code.
 */
export function uploadFilesWithTransloaditTus(
  createAssembly: CreateAssemblyHandler,
  files: File[],
  options: MultiFileTusUploadOptions,
): MultiFileTusUploadController {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const state: UploadState = {
    isUploading: true,
    progress: 0,
    error: null,
  };
  const results: MultiFileTusUploadResult["files"] = files.map((file) => ({
    file,
    status: "canceled",
  }));
  const inFlight = new Set<Upload>();
  const abortController = new AbortController();
  let cancelled = false;

  const emitState = (next: UploadState) => {
    state.isUploading = next.isUploading;
    state.progress = next.progress;
    state.error = next.error;
    options.onStateChange?.(next);
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    abortController.abort();
    for (const uploader of inFlight) {
      try {
        uploader.abort(true);
      } catch {
        // ignore abort errors
      }
    }
  };

  if (options.signal) {
    if (options.signal.aborted) {
      cancel();
    } else {
      options.signal.addEventListener("abort", cancel, { once: true });
    }
  }

  const promise = (async () => {
    if (files.length === 0) {
      throw new Error("No files provided for upload");
    }

    emitState({ ...state });

    const assembly = await createAssembly({
      templateId: options.templateId,
      steps: options.steps,
      fields: options.fields,
      notifyUrl: options.notifyUrl,
      numExpectedUploadFiles: options.numExpectedUploadFiles ?? files.length,
      expires: options.expires,
      additionalParams: options.additionalParams,
      userId: options.userId,
    });

    options.onAssemblyCreated?.(assembly);

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

    const perFileBytes = new Map<number, { uploaded: number; total: number }>();
    const updateOverallProgress = () => {
      let totalUploaded = 0;
      let totalBytes = 0;
      for (const { uploaded, total } of perFileBytes.values()) {
        totalUploaded += uploaded;
        totalBytes += total;
      }
      const overall =
        totalBytes > 0 ? Math.round((totalUploaded / totalBytes) * 100) : 0;
      emitState({ isUploading: true, progress: overall, error: null });
      options.onOverallProgress?.(overall);
    };

    const resolveMetadata = (file: File) =>
      typeof options.metadata === "function"
        ? options.metadata(file)
        : options.metadata;

    const resolveFieldName = (file: File) =>
      typeof options.fieldName === "function"
        ? options.fieldName(file)
        : options.fieldName;

    const uploadFile = async (file: File, index: number) => {
      const { endpoint, metadata } = buildTusUploadConfig(assembly.data, file, {
        fieldName: resolveFieldName(file),
        metadata: resolveMetadata(file),
      });

      let uploadUrl: string | null = null;
      let rateLimitAttempt = 0;
      let uploader: Upload | null = null;

      const runUpload = () =>
        new Promise<void>((resolve, reject) => {
          if (cancelled) {
            reject(new Error("Upload canceled"));
            return;
          }
          const onAbort = () => {
            reject(new Error("Upload canceled"));
          };
          abortController.signal.addEventListener("abort", onAbort, {
            once: true,
          });

          let currentUploader: Upload;
          const uploadOptions: ConstructorParameters<typeof Upload>[1] = {
            endpoint,
            metadata,
            retryDelays,
            uploadDataDuringCreation: options.uploadDataDuringCreation ?? false,
            onUploadUrlAvailable: () => {
              uploadUrl = currentUploader.url;
            },
            onShouldRetry: (error, retryAttempt) =>
              options.onShouldRetry?.(error, retryAttempt) ??
              shouldRetry(error),
            onProgress: (bytesUploaded, bytesTotal) => {
              perFileBytes.set(index, {
                uploaded: bytesUploaded,
                total: bytesTotal,
              });
              const progress = Math.round((bytesUploaded / bytesTotal) * 100);
              options.onFileProgress?.(file, progress);
              updateOverallProgress();
            },
            onError: (error) => {
              abortController.signal.removeEventListener("abort", onAbort);
              reject(error);
            },
            onSuccess: () => {
              abortController.signal.removeEventListener("abort", onAbort);
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

          currentUploader = new Upload(file, uploadOptions);
          uploader = currentUploader;
          inFlight.add(currentUploader);

          currentUploader.start();
        }).finally(() => {
          if (uploader) {
            inFlight.delete(uploader);
          }
        });

      while (true) {
        try {
          await runUpload();
          break;
        } catch (error) {
          if (cancelled) {
            throw error;
          }
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
    };

    let nextIndex = 0;
    const errors: Error[] = [];

    const worker = async () => {
      while (true) {
        if (cancelled) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= files.length) return;
        const file = files[index];
        try {
          await uploadFile(file, index);
          results[index] = { file, status: "success" };
          options.onFileComplete?.(file);
        } catch (error) {
          if (cancelled) {
            results[index] = { file, status: "canceled" };
            return;
          }
          const err =
            error instanceof Error ? error : new Error("Upload failed");
          results[index] = { file, status: "error", error: err };
          errors.push(err);
          options.onFileError?.(file, err);
          if (options.failFast ?? false) {
            cancel();
            return;
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, files.length) }, worker),
    );

    if (cancelled) {
      const error = new Error("Upload canceled");
      (error as Error & { results?: MultiFileTusUploadResult }).results = {
        assemblyId: assembly.assemblyId,
        data: assembly.data,
        files: results,
      };
      throw error;
    }

    const hasErrors = results.some((result) => result.status === "error");
    const resultPayload: MultiFileTusUploadResult = {
      assemblyId: assembly.assemblyId,
      data: assembly.data,
      files: results,
    };

    if (hasErrors) {
      const error = new Error(
        `Failed to upload ${errors.length} file${errors.length === 1 ? "" : "s"}`,
      );
      (error as Error & { results?: MultiFileTusUploadResult }).results =
        resultPayload;
      throw error;
    }

    emitState({ isUploading: false, progress: 100, error: null });
    return resultPayload;
  })();

  return { promise, cancel };
}

export function useTransloaditUpload(
  options: UseTransloaditUploadOptions,
): UseTransloaditUploadResult {
  const create = useAction(options.createAssembly);
  const refresh = useAction(options.refreshAssembly);
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [assemblyData, setAssemblyData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const upload = useCallback(
    async (
      files: File | File[] | FileList,
      uploadOptions: MultiFileTusUploadOptions,
    ) => {
      const resolved =
        files instanceof FileList
          ? Array.from(files)
          : Array.isArray(files)
            ? files
            : [files];

      const controller = uploadFilesWithTransloaditTus(create, resolved, {
        ...uploadOptions,
        onStateChange: setState,
        onAssemblyCreated: (assembly) => {
          setAssemblyId(assembly.assemblyId);
          setAssemblyData(assembly.data);
          uploadOptions.onAssemblyCreated?.(assembly);
        },
      });

      cancelRef.current = controller.cancel;

      try {
        const result = await controller.promise;
        setAssemblyId(result.assemblyId);
        setAssemblyData(result.data);
        return result;
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error("Upload failed");
        setState({ isUploading: false, progress: 0, error: resolvedError });
        throw error;
      } finally {
        cancelRef.current = null;
      }
    },
    [create],
  );

  const cancel = useCallback(() => {
    cancelRef.current?.();
  }, []);

  const reset = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setAssemblyId(null);
    setAssemblyData(null);
    setState({ isUploading: false, progress: 0, error: null });
  }, []);

  const assembly = useQuery(
    options.getStatus,
    assemblyId ? { assemblyId } : "skip",
  );

  const parsedStatus = useMemo(() => {
    const candidate =
      assembly && typeof assembly === "object"
        ? ((assembly as { raw?: unknown }).raw ?? assembly)
        : assembly;
    return parseAssemblyStatus(candidate);
  }, [assembly]);

  const results = useQuery(
    options.listResults,
    assemblyId ? { assemblyId } : "skip",
  );

  useAssemblyPoller({
    assemblyId,
    status: parsedStatus,
    refresh: async () => {
      if (!assemblyId) return;
      await refresh({ assemblyId });
    },
    intervalMs: options.pollIntervalMs ?? 5000,
    shouldContinue: options.shouldContinue,
    onError: options.onError,
  });

  return {
    upload,
    cancel,
    reset,
    isUploading: state.isUploading,
    progress: state.progress,
    error: state.error,
    assemblyId,
    assemblyData,
    assembly,
    status: parsedStatus,
    results,
  };
}

export function useTransloaditUppy<
  TArgs extends { fileCount: number },
  TAssembly extends { assemblyId: string; data: Record<string, unknown> },
>(
  options: UseTransloaditUppyOptions<TArgs, TAssembly>,
): UseTransloaditUppyResult<TAssembly> {
  const create = useAction(options.createAssembly) as unknown as (
    args: TArgs,
  ) => Promise<TAssembly>;
  const refresh = useAction(options.refreshAssembly);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [assemblyData, setAssemblyData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [uploadResult, setUploadResult] = useState<UppyUploadResult | null>(
    null,
  );

  const assembly = useQuery(
    options.getStatus,
    assemblyId ? { assemblyId } : "skip",
  );
  const results = useQuery(
    options.listResults,
    assemblyId ? { assemblyId } : "skip",
  );
  const parsedStatus = useMemo(() => {
    const candidate =
      assembly && typeof assembly === "object"
        ? ((assembly as { raw?: unknown }).raw ?? assembly)
        : assembly;
    return parseAssemblyStatus(candidate);
  }, [assembly]);

  useAssemblyPoller({
    assemblyId,
    status: parsedStatus,
    refresh: async () => {
      if (!assemblyId) return;
      await refresh({ assemblyId });
    },
    intervalMs: options.pollIntervalMs ?? 5000,
    shouldContinue: options.shouldContinue,
    onError: options.onError,
  });

  const startUpload = useCallback(
    async (
      overrides?: Partial<UploadWithAssemblyOptions<{ fileCount: number }>>,
    ) => {
      setError(null);
      setIsUploading(true);

      try {
        const files = options.uppy.getFiles();
        if (files.length === 0) {
          throw new Error("No files provided for upload");
        }

        const createAssemblyArgs = {
          ...(options.createAssemblyArgs ?? {}),
          ...(overrides?.createAssemblyArgs ?? {}),
        } as TArgs;

        const { assembly, uploadResult: result } = await uploadWithAssembly<
          TArgs,
          TAssembly
        >(create, options.uppy, {
          fileCount: overrides?.fileCount ?? options.fileCount ?? files.length,
          fieldName: overrides?.fieldName ?? options.fieldName,
          metadata: overrides?.metadata ?? options.metadata,
          addRequestId: overrides?.addRequestId ?? options.addRequestId,
          createAssemblyArgs,
          onAssemblyCreated: (created) => {
            const typed = created as TAssembly;
            setAssemblyId(typed.assemblyId);
            setAssemblyData(typed.data);
            options.onAssemblyCreated?.(typed);
            overrides?.onAssemblyCreated?.(created);
          },
        });

        setAssemblyId(assembly.assemblyId);
        setAssemblyData(assembly.data);
        setUploadResult(result);
        options.onUploadResult?.(result);
        setIsUploading(false);
        return { assembly, uploadResult: result };
      } catch (err) {
        const resolved =
          err instanceof Error ? err : new Error("Upload failed");
        setError(resolved);
        setIsUploading(false);
        throw resolved;
      }
    },
    [
      create,
      options.addRequestId,
      options.createAssemblyArgs,
      options.fieldName,
      options.fileCount,
      options.metadata,
      options.onAssemblyCreated,
      options.onUploadResult,
      options.uppy,
    ],
  );

  const reset = useCallback(() => {
    setIsUploading(false);
    setError(null);
    setAssemblyId(null);
    setAssemblyData(null);
    setUploadResult(null);
  }, []);

  const stage = useMemo(() => {
    if (error) return "error";
    if (isUploading) return "uploading";
    return parsedStatus ? getAssemblyStage(parsedStatus) : null;
  }, [error, isUploading, parsedStatus]);

  return {
    startUpload,
    reset,
    isUploading,
    error,
    assemblyId,
    assemblyData,
    assembly,
    status: parsedStatus,
    results,
    stage,
    uploadResult,
  };
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
  options?: {
    pollIntervalMs?: number;
    stopOnTerminal?: boolean;
    shouldContinue?: () => boolean;
    onError?: (error: Error) => void;
  },
) {
  const status = useQuery(getStatus, { assemblyId });
  const refresh = useAction(refreshAssembly);
  const statusRef = useRef(status);
  const shouldContinueRef = useRef(options?.shouldContinue);
  const onErrorRef = useRef(options?.onError);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    shouldContinueRef.current = options?.shouldContinue;
  }, [options?.shouldContinue]);

  useEffect(() => {
    onErrorRef.current = options?.onError;
  }, [options?.onError]);

  useEffect(() => {
    if (!assemblyId) return;
    const intervalMs = options?.pollIntervalMs ?? 5000;
    if (intervalMs <= 0) return;

    const shouldKeepPolling = () => {
      const shouldContinue = shouldContinueRef.current?.();
      if (shouldContinue === false) return false;
      if (!options?.stopOnTerminal) return true;
      const current = statusRef.current;
      const rawCandidate =
        current && typeof current === "object"
          ? ((current as { raw?: unknown }).raw ?? current)
          : current;
      const parsed = parseAssemblyStatus(rawCandidate);
      return !(parsed ? isAssemblyTerminal(parsed) : false);
    };

    if (!shouldKeepPolling()) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (!shouldKeepPolling()) {
        if (intervalId) clearInterval(intervalId);
        cancelled = true;
        return;
      }
      try {
        await refresh({ assemblyId });
      } catch (error) {
        const resolved =
          error instanceof Error ? error : new Error("Refresh failed");
        onErrorRef.current?.(resolved);
      }
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

/**
 * @deprecated Prefer `useAssemblyStatusWithPolling` for public usage.
 */
export function useAssemblyPoller(options: {
  assemblyId: string | null;
  status: AssemblyStatus | null | undefined;
  refresh: () => Promise<void>;
  intervalMs: number;
  shouldContinue?: () => boolean;
  onError?: (error: Error) => void;
}) {
  const refreshRef = useRef(options.refresh);
  const onErrorRef = useRef(options.onError);
  const shouldContinueRef = useRef(options.shouldContinue);
  const statusRef = useRef(options.status);

  useEffect(() => {
    refreshRef.current = options.refresh;
  }, [options.refresh]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    shouldContinueRef.current = options.shouldContinue;
  }, [options.shouldContinue]);

  useEffect(() => {
    statusRef.current = options.status;
  }, [options.status]);

  useEffect(() => {
    if (!options.assemblyId) return;

    const controller = pollAssembly({
      intervalMs: options.intervalMs,
      refresh: () => refreshRef.current(),
      shouldContinue: () => shouldContinueRef.current?.() ?? false,
      isTerminal: () => {
        const current = statusRef.current;
        return current ? isAssemblyTerminal(current) : false;
      },
      onError: (error) => {
        onErrorRef.current?.(error);
      },
    });

    return () => {
      controller.stop();
    };
  }, [options.assemblyId, options.intervalMs]);
}

export function useTransloaditFiles(
  listResults: ListResultsFn,
  args: { assemblyId: string; stepName?: string; limit?: number },
) {
  return useQuery(listResults, args);
}
