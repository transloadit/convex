/// <reference types="vite/client" />
// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  CreateAssemblyFn,
  GetAssemblyStatusFn,
  ListResultsFn,
  RefreshAssemblyFn,
} from "./index.tsx";
import {
  useAssemblyStatusWithPolling,
  useTransloaditUpload,
} from "./index.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let currentStatus: unknown = null;
let currentResults: unknown = null;
let queryHandler: (fn: unknown, args: unknown) => unknown = () => currentStatus;
const refreshMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const actionMock = vi.hoisted(() => vi.fn((fn: unknown) => fn));
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: queryMock,
  useAction: actionMock,
}));

vi.mock("tus-js-client", () => {
  type UploadOptions = {
    endpoint?: string;
    onUploadUrlAvailable?: () => void;
    onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
    onSuccess?: () => void;
  };

  return {
    Upload: class MockUpload {
      url?: string;
      private options: UploadOptions;
      constructor(_file: File, options: UploadOptions) {
        this.options = options;
        this.url = options?.endpoint
          ? `${options.endpoint}/upload`
          : "https://tus.mock/upload";
      }
      start() {
        this.options?.onUploadUrlAvailable?.();
        this.options?.onProgress?.(1, 1);
        this.options?.onSuccess?.();
      }
      abort() {
        // no-op for tests
      }
    },
  };
});

const noopGetStatus = (() => null) as unknown as Parameters<
  typeof useAssemblyStatusWithPolling
>[0];
const noopRefresh = refreshMock as unknown as RefreshAssemblyFn;

queryMock.mockImplementation((fn, args) => queryHandler(fn, args));

describe("useAssemblyStatusWithPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
    refreshMock.mockClear();
    actionMock.mockClear();
    queryMock.mockClear();
    currentResults = null;
    currentStatus = null;
    queryHandler = () => currentStatus;
    queryMock.mockImplementation((fn, args) => queryHandler(fn, args));
  });

  test("does not trigger immediate refresh on status change", async () => {
    vi.useFakeTimers();
    currentStatus = { ok: "ASSEMBLY_UPLOADING" };

    const { rerender, unmount } = renderHook(
      ({ assemblyId }: { assemblyId: string }) =>
        useAssemblyStatusWithPolling(noopGetStatus, noopRefresh, assemblyId, {
          pollIntervalMs: 1000,
        }),
      { initialProps: { assemblyId: "asm_1" } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(refreshMock).toHaveBeenCalledTimes(2);

    currentStatus = { ok: "ASSEMBLY_COMPLETED" };
    rerender({ assemblyId: "asm_1" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshMock).toHaveBeenCalledTimes(2);

    unmount();
  });
});

describe("useTransloaditUpload", () => {
  afterEach(() => {
    actionMock.mockClear();
    queryMock.mockClear();
    currentResults = null;
    currentStatus = null;
    queryHandler = () => currentStatus;
  });

  test("uploads files and exposes status/results", async () => {
    const createAssembly = vi.fn(async () => ({
      assemblyId: "asm_123",
      data: {
        tus_url: "https://tus.example.com",
        assembly_ssl_url: "https://api2.transloadit.com/assemblies/asm_123",
      },
    }));

    const getStatus = {} as GetAssemblyStatusFn;
    const listResults = {} as ListResultsFn;
    const refreshAssembly = refreshMock as unknown as RefreshAssemblyFn;
    currentStatus = { raw: { ok: "ASSEMBLY_UPLOADING" } };
    currentResults = [{ stepName: "resize", raw: { ssl_url: "https://file" } }];
    queryHandler = (fn) => {
      if (fn === getStatus) return currentStatus;
      if (fn === listResults) return currentResults;
      return null;
    };
    queryMock.mockImplementation((fn, args) => queryHandler(fn, args));

    const { result } = renderHook(() =>
      useTransloaditUpload({
        createAssembly: createAssembly as unknown as CreateAssemblyFn,
        getStatus,
        listResults,
        refreshAssembly,
      }),
    );

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await act(async () => {
      await result.current.upload([file], {
        steps: { resize: { robot: "/image/resize" } },
      });
    });

    expect(createAssembly).toHaveBeenCalled();
    expect(result.current.assemblyId).toBe("asm_123");
    expect(result.current.results).toEqual(currentResults);
    expect(result.current.status?.ok).toBe("ASSEMBLY_UPLOADING");
  });
});
