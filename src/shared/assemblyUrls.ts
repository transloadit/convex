import {
  type AssemblyStatus,
  type AssemblyStatusResults,
  assemblyStatusSchema,
  isAssemblyBusyStatus,
  isAssemblyTerminalError,
  isAssemblyTerminalOk,
} from "@transloadit/zod/v3/assemblyStatus";

export type TransloaditAssembly = AssemblyStatus;

export const ASSEMBLY_STATUS_COMPLETED = "ASSEMBLY_COMPLETED" as const;
export const ASSEMBLY_STATUS_UPLOADING = "ASSEMBLY_UPLOADING" as const;

export const isAssemblyCompletedStatus = (
  status: string | null | undefined,
): status is typeof ASSEMBLY_STATUS_COMPLETED =>
  status === ASSEMBLY_STATUS_COMPLETED;

export const isAssemblyUploadingStatus = (
  status: string | null | undefined,
): status is typeof ASSEMBLY_STATUS_UPLOADING =>
  status === ASSEMBLY_STATUS_UPLOADING;

export type AssemblyStage = "uploading" | "processing" | "complete" | "error";

export const getAssemblyStage = (
  status: AssemblyStatus | null | undefined,
): AssemblyStage | null => {
  if (!status) return null;
  const ok = typeof status.ok === "string" ? status.ok : null;
  if (isAssemblyCompletedStatus(ok)) return "complete";
  if (isAssemblyBusyStatus(ok)) {
    return isAssemblyUploadingStatus(ok) ? "uploading" : "processing";
  }
  if (isAssemblyTerminalError(status)) return "error";
  if (isAssemblyTerminalOk(status)) return "error";
  return null;
};

export type AssemblyUrlFields = {
  tus_url?: string;
  tusUrl?: string;
  assembly_ssl_url?: string;
  assembly_url?: string;
  assemblyUrl?: string;
};

export type AssemblyUrls = {
  tusUrl: string | null;
  assemblyUrl: string | null;
};

export type NormalizedAssemblyUrls = {
  tus: { url: string | null };
  assembly: { url: string | null };
};

const tusUrlKeys = ["tus_url", "tusUrl"] as const;
const assemblyUrlKeys = [
  "assembly_ssl_url",
  "assembly_url",
  "assemblyUrl",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const pickString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
};

export const parseAssemblyUrls = (data: unknown): AssemblyUrls => {
  if (!isRecord(data)) {
    return { tusUrl: null, assemblyUrl: null };
  }

  return {
    tusUrl: pickString(data, tusUrlKeys),
    assemblyUrl: pickString(data, assemblyUrlKeys),
  };
};

export const normalizeAssemblyUploadUrls = (
  data: unknown,
): NormalizedAssemblyUrls => {
  const { tusUrl, assemblyUrl } = parseAssemblyUrls(data);
  return {
    tus: { url: tusUrl },
    assembly: { url: assemblyUrl },
  };
};

export const parseAssemblyStatus = (
  data: unknown,
): TransloaditAssembly | null => {
  const parsed = assemblyStatusSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
};

export const parseAssemblyFields = (data: unknown): Record<string, unknown> => {
  const status = parseAssemblyStatus(data);
  const fields = status?.fields;
  return isRecord(fields) ? fields : {};
};

export const parseAssemblyResults = (data: unknown): AssemblyStatusResults => {
  const status = parseAssemblyStatus(data);
  const results = status?.results;
  if (!isRecord(results)) return {};

  const output: AssemblyStatusResults = {};
  for (const [key, value] of Object.entries(results)) {
    if (Array.isArray(value)) {
      output[key] = value as AssemblyStatusResults[string];
    }
  }
  return output;
};
