import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  buildTransloaditParams,
  signTransloaditParams,
  verifyWebhookSignature,
} from "./apiUtils.js";

describe("apiUtils", () => {
  test("buildTransloaditParams requires templateId or steps", () => {
    expect(() =>
      buildTransloaditParams({
        authKey: "key",
      }),
    ).toThrow("Provide either templateId or steps");
  });

  test("signTransloaditParams uses sha384", async () => {
    const { paramsString } = buildTransloaditParams({
      authKey: "key",
      templateId: "tmpl_123",
      notifyUrl: "https://example.com/webhook",
    });

    const signature = await signTransloaditParams(paramsString, "secret");
    expect(signature.startsWith("sha384:")).toBe(true);

    const expected = createHmac("sha384", "secret")
      .update(paramsString)
      .digest("hex");
    expect(signature).toBe(`sha384:${expected}`);
  });

  test("verifyWebhookSignature supports sha1 fallback", async () => {
    const payload = { ok: "ASSEMBLY_COMPLETED", assembly_id: "asm_123" };
    const rawBody = JSON.stringify(payload);
    const secret = "webhook-secret";
    const digest = createHmac("sha1", secret).update(rawBody).digest("hex");

    const verified = await verifyWebhookSignature({
      rawBody,
      signatureHeader: `sha1:${digest}`,
      authSecret: secret,
    });

    expect(verified).toBe(true);
  });
});
