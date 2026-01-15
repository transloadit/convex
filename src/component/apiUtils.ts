export interface TransloaditAuthConfig {
  authKey: string;
  authSecret: string;
}

export interface BuildParamsOptions {
  authKey: string;
  templateId?: string;
  steps?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  notifyUrl?: string;
  numExpectedUploadFiles?: number;
  expires?: string;
  additionalParams?: Record<string, unknown>;
}

export interface BuildParamsResult {
  params: Record<string, unknown>;
  paramsString: string;
}

export function buildTransloaditParams(
  options: BuildParamsOptions,
): BuildParamsResult {
  if (!options.templateId && !options.steps) {
    throw new Error("Provide either templateId or steps to create an Assembly");
  }

  const auth: Record<string, string> = {
    key: options.authKey,
  };

  auth.expires =
    options.expires ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const params: Record<string, unknown> = {
    auth,
  };

  if (options.templateId) params.template_id = options.templateId;
  if (options.steps) params.steps = options.steps;
  if (options.fields) params.fields = options.fields;
  if (options.notifyUrl) params.notify_url = options.notifyUrl;
  if (options.numExpectedUploadFiles !== undefined) {
    params.num_expected_upload_files = options.numExpectedUploadFiles;
  }

  if (options.additionalParams) {
    for (const [key, value] of Object.entries(options.additionalParams)) {
      if (value !== undefined) {
        params[key] = value;
      }
    }
  }

  return {
    params,
    paramsString: JSON.stringify(params),
  };
}

async function hmacHex(
  algorithm: "SHA-384" | "SHA-1",
  key: string,
  data: string,
): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      { name: "HMAC", hash: { name: algorithm } },
      false,
      ["sign"],
    );
    const signature = await globalThis.crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(data),
    );
    const bytes = new Uint8Array(signature);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  const { createHmac } = await import("node:crypto");
  return createHmac(algorithm.replace("-", "").toLowerCase(), key)
    .update(data)
    .digest("hex");
}

export async function signTransloaditParams(
  paramsString: string,
  authSecret: string,
): Promise<string> {
  const signature = await hmacHex("SHA-384", authSecret, paramsString);
  return `sha384:${signature}`;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyWebhookSignature(options: {
  rawBody: string;
  signatureHeader?: string;
  authSecret: string;
}): Promise<boolean> {
  if (!options.signatureHeader) return false;

  const signatureHeader = options.signatureHeader.trim();
  if (!signatureHeader) return false;

  const [prefix, sig] = signatureHeader.includes(":")
    ? (signatureHeader.split(":") as [string, string])
    : ["sha1", signatureHeader];

  const normalized = prefix.toLowerCase();
  const algorithm = normalized === "sha384" ? "SHA-384" : "SHA-1";

  if (normalized !== "sha384" && normalized !== "sha1") {
    return false;
  }

  const expected = await hmacHex(
    algorithm,
    options.authSecret,
    options.rawBody,
  );
  return safeCompare(expected, sig);
}

export type AssemblyResultRecord = {
  stepName: string;
  result: Record<string, unknown>;
};

export function flattenResults(
  results: Record<string, Array<Record<string, unknown>>> | undefined,
): AssemblyResultRecord[] {
  if (!results) return [];
  const output: AssemblyResultRecord[] = [];
  for (const [stepName, entries] of Object.entries(results)) {
    if (!Array.isArray(entries)) continue;
    for (const result of entries) {
      output.push({ stepName, result });
    }
  }
  return output;
}
