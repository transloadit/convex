import { useAction, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useMemo, useState } from "react";
import { Upload } from "tus-js-client";

export type GenerateUploadParamsFn = FunctionReference<
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
  { params: string; signature: string; url: string }
>;

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

export interface FormUploadOptions extends UploadOptions {
  fileField?: string;
  onProgress?: (progress: number) => void;
}

export interface TusUploadOptions extends UploadOptions {
  metadata?: Record<string, string>;
  chunkSize?: number;
  retryDelays?: number[];
  onProgress?: (progress: number) => void;
}

async function uploadViaForm(
  file: File,
  params: { params: string; signature: string; url: string },
  options: FormUploadOptions,
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append("params", params.params);
  formData.append("signature", params.signature);
  formData.append(options.fileField ?? "file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", params.url, true);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      options.onProgress?.(progress);
    };

    xhr.onload = () => {
      try {
        const response = JSON.parse(xhr.responseText) as Record<
          string,
          unknown
        >;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(response);
        } else {
          reject(
            new Error(
              `Transloadit upload failed (${xhr.status}): ${JSON.stringify(response)}`,
            ),
          );
        }
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => {
      reject(new Error("Transloadit upload failed"));
    };

    xhr.send(formData);
  });
}

export function useTransloaditUpload(
  generateUploadParams: GenerateUploadParamsFn,
) {
  const generate = useAction(generateUploadParams);
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  const upload = useCallback(
    async (file: File, options: FormUploadOptions) => {
      setState({ isUploading: true, progress: 0, error: null });
      try {
        const params = await generate({
          templateId: options.templateId,
          steps: options.steps,
          fields: options.fields,
          notifyUrl: options.notifyUrl,
          numExpectedUploadFiles: options.numExpectedUploadFiles,
          expires: options.expires,
          additionalParams: options.additionalParams,
          userId: options.userId,
        });

        const response = await uploadViaForm(file, params, {
          ...options,
          onProgress: (progress) => {
            setState((prev) => ({ ...prev, progress }));
            options.onProgress?.(progress);
          },
        });

        setState({ isUploading: false, progress: 100, error: null });
        return response;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Upload failed");
        setState({ isUploading: false, progress: 0, error: err });
        throw err;
      }
    },
    [generate],
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
        const tusUrl =
          (typeof data.tus_url === "string" && data.tus_url) ||
          (typeof data.tusUrl === "string" && data.tusUrl) ||
          "";

        if (!tusUrl) {
          throw new Error(
            "Transloadit response missing tus_url for resumable upload",
          );
        }

        const metadata: Record<string, string> = {
          filename: file.name,
          filetype: file.type,
          ...options.metadata,
        };

        await new Promise<void>((resolve, reject) => {
          const uploader = new Upload(file, {
            endpoint: tusUrl,
            metadata,
            chunkSize: options.chunkSize,
            retryDelays: options.retryDelays ?? [0, 3000, 5000, 10000],
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
          });

          uploader.start();
        });

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

export function useTransloaditFiles(
  listResults: ListResultsFn,
  args: { assemblyId: string; stepName?: string; limit?: number },
) {
  return useQuery(listResults, args);
}
