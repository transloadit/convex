import type { IncomingMessage } from "node:http";
import { parseMultipart } from "./http.js";

export type WebhookPayload = {
  ok?: string;
  assembly_id?: string;
  [key: string]: unknown;
};

export type ParsedWebhook = {
  payload: WebhookPayload;
  rawPayload: string;
  signature: string;
};

export const parseWebhookPayload = (
  req: IncomingMessage,
  body: Buffer,
): ParsedWebhook => {
  const contentType = req.headers["content-type"] ?? "";
  let rawPayload = "";
  let signature = "";
  let payload: WebhookPayload | undefined;

  if (contentType.includes("multipart/form-data")) {
    const fields = parseMultipart(body, contentType);
    rawPayload = fields.transloadit ?? "";
    signature = fields.signature ?? "";
    if (!rawPayload) {
      throw new Error("Missing transloadit payload");
    }
    payload = JSON.parse(rawPayload) as WebhookPayload;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body.toString("utf8"));
    rawPayload = params.get("transloadit") ?? "";
    signature = params.get("signature") ?? "";
    if (!rawPayload) {
      throw new Error("Missing transloadit payload");
    }
    payload = JSON.parse(rawPayload) as WebhookPayload;
  } else {
    rawPayload = body.toString("utf8");
    payload = JSON.parse(rawPayload) as WebhookPayload;
    signature = (
      req.headers["x-transloadit-signature"] ||
      req.headers["x-signature"] ||
      req.headers["transloadit-signature"] ||
      ""
    ).toString();
    const payloadRecord = payload as Record<string, unknown>;
    const nestedPayload = payloadRecord.transloadit;
    if (typeof nestedPayload === "string") {
      rawPayload = nestedPayload;
      payload = JSON.parse(rawPayload) as WebhookPayload;
    }
    const nestedSignature = payloadRecord.signature;
    if (typeof nestedSignature === "string") {
      signature = nestedSignature;
    }
  }

  if (!payload) {
    throw new Error("Missing payload");
  }

  return { payload, rawPayload, signature };
};
