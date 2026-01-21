import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_STATUS_COMPLETED,
  ASSEMBLY_STATUS_UPLOADING,
  isAssemblyCompletedStatus,
  isAssemblyUploadingStatus,
  parseAssemblyFields,
  parseAssemblyResults,
  parseAssemblyStatus,
  parseAssemblyUrls,
} from "./assemblyUrls.ts";

describe("assembly helpers", () => {
  it("parses tus and assembly URLs with fallbacks", () => {
    const parsed = parseAssemblyUrls({
      tus_url: "https://tus.transloadit.com",
      assembly_ssl_url: "https://ssl.transloadit.com/assembly",
      assembly_url: "https://transloadit.com/assembly",
    });

    expect(parsed).toEqual({
      tusUrl: "https://tus.transloadit.com",
      assemblyUrl: "https://ssl.transloadit.com/assembly",
    });

    const fallback = parseAssemblyUrls({
      tusUrl: "https://tus.example.com",
      assemblyUrl: "https://assembly.example.com",
    });

    expect(fallback).toEqual({
      tusUrl: "https://tus.example.com",
      assemblyUrl: "https://assembly.example.com",
    });
  });

  it("parses assembly status, fields, and results safely", () => {
    const status = {
      ok: "ASSEMBLY_COMPLETED",
      fields: { album: "wedding-gallery" },
      results: {
        images_output: [
          {
            id: "result-1",
            ssl_url: "https://cdn.example.com/image.jpg",
          },
        ],
      },
    };

    expect(parseAssemblyStatus(status)?.ok).toBe("ASSEMBLY_COMPLETED");
    expect(parseAssemblyFields(status)).toEqual({ album: "wedding-gallery" });
    expect(Object.keys(parseAssemblyResults(status))).toEqual([
      "images_output",
    ]);

    expect(parseAssemblyStatus("nope")).toBeNull();
    expect(parseAssemblyFields("nope")).toEqual({});
    expect(parseAssemblyResults("nope")).toEqual({});
  });

  it("exposes canonical status helpers", () => {
    expect(isAssemblyCompletedStatus(ASSEMBLY_STATUS_COMPLETED)).toBe(true);
    expect(isAssemblyCompletedStatus(ASSEMBLY_STATUS_UPLOADING)).toBe(false);
    expect(isAssemblyUploadingStatus(ASSEMBLY_STATUS_UPLOADING)).toBe(true);
  });
});
