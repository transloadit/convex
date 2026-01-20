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
  value !== null && typeof value === "object";

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
