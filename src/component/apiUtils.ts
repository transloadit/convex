import type { AssemblyStatusResults } from "@transloadit/types/assemblyStatus";
import type { AssemblyInstructionsInput } from "@transloadit/types/template";

export interface TransloaditAuthConfig {
  authKey: string;
  authSecret: string;
}

export interface BuildParamsOptions {
  authKey: string;
  templateId?: string;
  steps?: AssemblyInstructionsInput["steps"];
  fields?: AssemblyInstructionsInput["fields"];
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
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to sign Transloadit payloads");
  }

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

export async function signTransloaditParams(
  paramsString: string,
  authSecret: string,
): Promise<string> {
  const signature = await hmacHex("SHA-384", authSecret, paramsString);
  return `sha384:${signature}`;
}

export type ParsedWebhookRequest = {
  payload: unknown;
  rawBody: string;
  signature?: string;
};

export type VerifiedWebhookRequest = ParsedWebhookRequest & {
  verified: boolean;
};

export async function parseTransloaditWebhook(
  request: Request,
): Promise<ParsedWebhookRequest> {
  const formData = await request.formData();
  const rawPayload = formData.get("transloadit");
  const signature = formData.get("signature");

  if (typeof rawPayload !== "string") {
    throw new Error("Missing transloadit payload");
  }

  return {
    payload: JSON.parse(rawPayload),
    rawBody: rawPayload,
    signature: typeof signature === "string" ? signature : undefined,
  };
}

export async function parseAndVerifyTransloaditWebhook(
  request: Request,
  options: {
    authSecret: string;
    requireSignature?: boolean;
  },
): Promise<VerifiedWebhookRequest> {
  const parsed = await parseTransloaditWebhook(request);
  const authSecret = options.authSecret;
  if (!authSecret) {
    throw new Error("Missing authSecret for webhook verification");
  }
  const verified = await verifyWebhookSignature({
    rawBody: parsed.rawBody,
    signatureHeader: parsed.signature,
    authSecret,
  });

  if (options.requireSignature ?? true) {
    if (!verified) {
      throw new Error("Invalid Transloadit webhook signature");
    }
  }

  return { ...parsed, verified };
}

export async function buildWebhookQueueArgs(
  request: Request,
  options: {
    authSecret: string;
    requireSignature?: boolean;
  },
): Promise<ParsedWebhookRequest> {
  if (options.requireSignature === false) {
    return parseTransloaditWebhook(request);
  }

  const parsed = await parseAndVerifyTransloaditWebhook(request, options);
  return {
    payload: parsed.payload,
    rawBody: parsed.rawBody,
    signature: parsed.signature,
  };
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

export type AssemblyResult = AssemblyStatusResults[string][number];

export type AssemblyResultRecord = {
  stepName: string;
  result: AssemblyResult;
};

export function flattenResults(
  results: AssemblyStatusResults | undefined,
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
