/// <reference types="vite/client" />

import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import schema from "./schema.ts";
import { modules } from "./setup.test.ts";

process.env.TRANSLOADIT_KEY = "test-key";
process.env.TRANSLOADIT_SECRET = "test-secret";

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

  test("handleWebhook requires rawBody when verifying signature", async () => {
    const t = convexTest(schema, modules);
    const payload = { assembly_id: "asm_missing" };
    const signature = createHmac("sha1", "test-secret")
      .update(JSON.stringify(payload))
      .digest("hex");

    await expect(
      t.action(api.lib.handleWebhook, {
        payload,
        signature: `sha1:${signature}`,
      }),
    ).rejects.toThrow("Missing rawBody for webhook verification");
  });

  test("queueWebhook rejects invalid signature", async () => {
    const t = convexTest(schema, modules);
    const payload = { assembly_id: "asm_bad" };
    const rawBody = JSON.stringify(payload);

    await expect(
      t.action(api.lib.queueWebhook, {
        payload,
        rawBody,
        signature: "sha1:bad",
      }),
    ).rejects.toThrow("Invalid Transloadit webhook signature");
  });

  test("refreshAssembly fetches status and stores results", async () => {
    const t = convexTest(schema, modules);

    const payload = {
      assembly_id: "asm_456",
      ok: "ASSEMBLY_COMPLETED",
      message: "Assembly complete",
      results: {
        resized: [
          {
            id: "file_2",
            ssl_url: "https://example.com/file-2.jpg",
            name: "file-2.jpg",
            size: 54321,
            mime: "image/jpeg",
          },
        ],
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await t.action(api.lib.refreshAssembly, {
        assemblyId: "asm_456",
        config: { authKey: "test-key", authSecret: "test-secret" },
      });

      expect(result.assemblyId).toBe("asm_456");
      expect(result.ok).toBe("ASSEMBLY_COMPLETED");

      const requestInfo = fetchMock.mock.calls[0]?.[0];
      const requestUrl =
        typeof requestInfo === "string"
          ? requestInfo
          : requestInfo instanceof URL
            ? requestInfo.toString()
            : requestInfo instanceof Request
              ? requestInfo.url
              : "";
      if (!requestUrl) {
        throw new Error("Expected fetch to be called with a URL string");
      }
      const url = new URL(requestUrl);
      expect(url.origin).toBe("https://api2.transloadit.com");
      expect(url.searchParams.get("signature")).toBeTruthy();
      expect(url.searchParams.get("params")).toBeTruthy();

      const assembly = await t.query(api.lib.getAssemblyStatus, {
        assemblyId: "asm_456",
      });
      expect(assembly?.ok).toBe("ASSEMBLY_COMPLETED");

      const results = await t.query(api.lib.listResults, {
        assemblyId: "asm_456",
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.stepName).toBe("resized");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
