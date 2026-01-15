import { useCallback, useEffect, useState } from "react";

export function useAction(ref) {
  return useCallback(
    async (args) => {
      if (!globalThis.__convexAction) {
        throw new Error("convex action bridge is not available");
      }
      return globalThis.__convexAction(ref, args ?? {});
    },
    [ref],
  );
}

export function useQuery(ref, args) {
  const [data, setData] = useState(null);
  const argsValue = args ?? {};

  useEffect(() => {
    let active = true;
    let timerId;

    const run = async () => {
      if (!globalThis.__convexQuery) return;
      try {
        const result = await globalThis.__convexQuery(ref, argsValue);
        if (active) {
          setData(result ?? null);
        }
      } catch {
        if (active) {
          setData(null);
        }
      }

      if (active) {
        timerId = globalThis.setTimeout(run, 750);
      }
    };

    run();

    return () => {
      active = false;
      if (timerId) {
        globalThis.clearTimeout(timerId);
      }
    };
  }, [ref, argsValue]);

  return data;
}

export function ConvexProvider({ children }) {
  return children;
}
