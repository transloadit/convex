/// <reference types="vite/client" />
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { UploadState } from "./index.tsx";

vi.mock("tus-js-client", () => {
  type UploadOptions = {
    onUploadUrlAvailable?: () => void;
    onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  };

  class Upload {
    url: string;
    options: UploadOptions;
    file: File;
    aborted = false;

    constructor(file: File, options: UploadOptions) {
      this.file = file;
      this.options = options;
      this.url = `https://upload.example.com/${encodeURIComponent(file.name)}`;
    }

    start() {
      const shouldFail = this.file.name.includes("fail");
      const delay = this.file.name.includes("slow") ? 25 : 0;
      this.options.onUploadUrlAvailable?.();
      this.options.onProgress?.(10, 10);
      setTimeout(() => {
        if (this.aborted) return;
        if (shouldFail) {
          this.options.onError?.(new Error("Upload failed"));
          return;
        }
        this.options.onSuccess?.();
      }, delay);
    }

    abort() {
      this.aborted = true;
    }
  }

  return { Upload };
});

import {
  uploadFilesWithTransloaditTus,
  uploadWithTransloaditTus,
} from "./index.tsx";

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

describe("uploadFilesWithTransloaditTus", () => {
  const createAssembly = vi.fn(async () => ({
    assemblyId: "asm_multi",
    data: {
      tus_url: "https://tus.transloadit.com",
      assembly_ssl_url: "https://transloadit.com/assembly",
    },
  }));

  it("uploads multiple files with overall progress", async () => {
    const files = [
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ];
    const overall: number[] = [];
    const perFile: Array<{ name: string; progress: number }> = [];

    const controller = uploadFilesWithTransloaditTus(createAssembly, files, {
      numExpectedUploadFiles: files.length,
      onOverallProgress: (progress) => overall.push(progress),
      onFileProgress: (file, progress) =>
        perFile.push({ name: file.name, progress }),
    });
    const result = await controller.promise;

    expect(result.assemblyId).toBe("asm_multi");
    expect(result.files.every((file) => file.status === "success")).toBe(true);
    expect(overall[overall.length - 1]).toBe(100);
    expect(perFile.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["one.txt", "two.txt"]),
    );
  });

  it("does not reach 100% before all files start", async () => {
    const files = [
      new File(["slow"], "slow.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ];
    const overall: number[] = [];

    const controller = uploadFilesWithTransloaditTus(createAssembly, files, {
      numExpectedUploadFiles: files.length,
      concurrency: 1,
      onOverallProgress: (progress) => overall.push(progress),
    });
    await controller.promise;

    expect(overall[0]).toBeLessThan(100);
  });

  it("returns results on partial failure when failFast is false", async () => {
    const files = [
      new File(["ok"], "ok.txt", { type: "text/plain" }),
      new File(["bad"], "fail.txt", { type: "text/plain" }),
    ];

    await expect(
      uploadFilesWithTransloaditTus(createAssembly, files, {
        failFast: false,
      }).promise,
    ).rejects.toThrow("Failed to upload");
  });

  it("cancels uploads and surfaces results", async () => {
    const files = [
      new File(["slow"], "slow.txt", { type: "text/plain" }),
      new File(["slow"], "slow-2.txt", { type: "text/plain" }),
    ];
    const controller = uploadFilesWithTransloaditTus(createAssembly, files, {
      failFast: true,
    });

    controller.cancel();

    await expect(controller.promise).rejects.toThrow("Upload canceled");
  });
});
