export type PollAssemblyOptions = {
  intervalMs: number;
  refresh: () => Promise<void>;
  isTerminal?: () => boolean;
  shouldContinue?: () => boolean;
  onError?: (error: Error) => void;
};

export type PollAssemblyController = {
  stop: () => void;
};

export const pollAssembly = (
  options: PollAssemblyOptions,
): PollAssemblyController => {
  const intervalMs = Math.max(0, options.intervalMs);
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const shouldKeepPolling = () => {
    if (!options.isTerminal?.()) return true;
    return options.shouldContinue?.() ?? false;
  };

  const stop = () => {
    cancelled = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  };

  if (intervalMs <= 0) {
    return { stop };
  }

  const poll = async () => {
    if (cancelled) return;
    if (!shouldKeepPolling()) {
      stop();
      return;
    }
    try {
      await options.refresh();
    } catch (error) {
      const resolved =
        error instanceof Error ? error : new Error("Refresh failed");
      options.onError?.(resolved);
    }
  };

  void poll();
  intervalId = setInterval(() => {
    void poll();
  }, intervalMs);

  return { stop };
};
