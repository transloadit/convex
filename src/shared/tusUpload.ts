import { parseAssemblyUrls } from "./assemblyUrls.ts";

export type TusUploadConfig = {
  endpoint: string;
  metadata: Record<string, string>;
  addRequestId: boolean;
  tusUrl: string;
  assemblyUrl: string;
};

export type TusMetadataOptions = {
  fieldName?: string;
  metadata?: Record<string, string>;
};

export const buildTusUploadConfig = (
  assemblyData: unknown,
  file: File,
  options: TusMetadataOptions = {},
): TusUploadConfig => {
  const { tusUrl, assemblyUrl } = parseAssemblyUrls(assemblyData);

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

  return {
    endpoint: tusUrl,
    metadata,
    addRequestId: true,
    tusUrl,
    assemblyUrl,
  };
};
