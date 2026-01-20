import type {
  AssemblyStatus,
  AssemblyStatusResults,
} from "@transloadit/types/assemblyStatus";

export type TransloaditAssembly = AssemblyStatus;

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

export const parseAssemblyStatus = (
  data: unknown,
): TransloaditAssembly | null => {
  if (!isRecord(data)) return null;
  return data as TransloaditAssembly;
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
