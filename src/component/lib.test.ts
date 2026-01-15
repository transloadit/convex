/// <reference types="vite/client" />

import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

process.env.TRANSLOADIT_AUTH_KEY = "test-key";
process.env.TRANSLOADIT_AUTH_SECRET = "test-secret";

describe("Transloadit component lib", () => {
  test("handleWebhook stores assembly and results", async () => {
    const t = convexTest(schema, modules);

    const payload = {
      assembly_id: "asm_123",
      ok: "ASSEMBLY_COMPLETED",
      message: "Assembly complete",
      results: {
        resized: [
          {
            id: "file_1",
            ssl_url: "https://example.com/file.jpg",
            name: "file.jpg",
            size: 12345,
            mime: "image/jpeg",
          },
        ],
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha1", "test-secret")
      .update(rawBody)
      .digest("hex");

    const result = await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
      verifySignature: true,
    });

    expect(result.assemblyId).toBe("asm_123");
    expect(result.resultCount).toBe(1);

    const assembly = await t.query(api.lib.getAssemblyStatus, {
      assemblyId: "asm_123",
    });

    expect(assembly?.assemblyId).toBe("asm_123");
    expect(assembly?.ok).toBe("ASSEMBLY_COMPLETED");

    const results = await t.query(api.lib.listResults, {
      assemblyId: "asm_123",
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.stepName).toBe("resized");
  });
});
