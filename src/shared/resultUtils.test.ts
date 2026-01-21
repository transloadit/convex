import { describe, expect, it } from "vitest";
import { getResultOriginalKey, getResultUrl } from "./resultUtils.ts";

describe("result utils", () => {
  it("extracts result URLs with common fallbacks", () => {
    expect(getResultUrl({ ssl_url: "https://cdn.example.com/file.jpg" })).toBe(
      "https://cdn.example.com/file.jpg",
    );
    expect(
      getResultUrl({
        meta: { url: "https://cdn.example.com/meta.jpg" },
      }),
    ).toBe("https://cdn.example.com/meta.jpg");
  });

  it("derives original keys from raw metadata", () => {
    expect(
      getResultOriginalKey({
        raw: { original_id: "orig_1" },
      }),
    ).toBe("orig_1");
    expect(
      getResultOriginalKey({
        raw: { original_basename: "photo.jpg" },
      }),
    ).toBe("photo.jpg");
    expect(getResultOriginalKey({ name: "fallback.jpg" })).toBe("fallback.jpg");
  });
});
