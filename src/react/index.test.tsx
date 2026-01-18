/// <reference types="vite/client" />
// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RefreshAssemblyFn } from "./index.js";
import { useAssemblyStatusWithPolling } from "./index.js";

let currentStatus: unknown = null;
const refreshMock = vi.fn(() => Promise.resolve());

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => currentStatus),
  useAction: vi.fn(() => refreshMock),
}));

const noopGetStatus = (() => null) as unknown as Parameters<
  typeof useAssemblyStatusWithPolling
>[0];
const noopRefresh = (() => null) as unknown as RefreshAssemblyFn;

describe("useAssemblyStatusWithPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
    refreshMock.mockClear();
    currentStatus = null;
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
