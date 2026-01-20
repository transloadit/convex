/// <reference types="vite/client" />
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { UploadState } from "./index.tsx";

vi.mock("tus-js-client", () => {
  class Upload {
    url = "https://upload.example.com";
    options: {
      onUploadUrlAvailable?: () => void;
      onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
      onSuccess?: () => void;
    };

    constructor(_file: File, options: Upload["options"]) {
      this.options = options;
    }

    start() {
      this.options.onUploadUrlAvailable?.();
      this.options.onProgress?.(10, 10);
      this.options.onSuccess?.();
    }
  }

  return { Upload };
});

import { uploadWithTransloaditTus } from "./index.tsx";

describe("uploadWithTransloaditTus", () => {
  it("uploads with tus and emits progress", async () => {
    const createAssembly = vi.fn(async () => ({
      assemblyId: "asm_123",
      data: {
        tus_url: "https://tus.transloadit.com",
        assembly_ssl_url: "https://transloadit.com/assembly",
      },
    }));
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const states: UploadState[] = [];
    const progress: number[] = [];

    const result = await uploadWithTransloaditTus(
      createAssembly,
      file,
      {
        numExpectedUploadFiles: 1,
        onProgress: (value) => progress.push(value),
      },
      {
        onStateChange: (state) => states.push(state),
      },
    );

    expect(createAssembly).toHaveBeenCalledWith(
      expect.objectContaining({ numExpectedUploadFiles: 1 }),
    );
    expect(result.assemblyId).toBe("asm_123");
    expect(progress).toContain(100);
    expect(states[0]).toEqual({ isUploading: true, progress: 0, error: null });
    expect(states[states.length - 1]).toEqual({
      isUploading: false,
      progress: 100,
      error: null,
    });
  });

  it("fails when tus_url is missing", async () => {
    const createAssembly = vi.fn(async () => ({
      assemblyId: "asm_456",
      data: {},
    }));
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const states: UploadState[] = [];

    await expect(
      uploadWithTransloaditTus(
        createAssembly,
        file,
        { numExpectedUploadFiles: 1 },
        { onStateChange: (state) => states.push(state) },
      ),
    ).rejects.toThrow("tus_url");

    const lastState = states[states.length - 1];
    expect(lastState?.error).toBeInstanceOf(Error);
    expect(lastState?.isUploading).toBe(false);
  });
});
