type ConsoleSink = Pick<Console, 'log' | 'info' | 'warn' | 'error'>;

export type DebugLogger = {
  enabled: boolean;
  log: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  event: (name: string, meta?: Record<string, unknown>) => void;
  child: (namespace: string) => DebugLogger;
};

export type DebugLoggerOptions = {
  namespace?: string;
  enabled?: boolean;
  sink?: ConsoleSink;
  clock?: () => Date;
};

const resolveEnv = (): Record<string, string | undefined> => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env;
  }
  return {};
};

const parseEnabled = (value: string | undefined) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const formatLine = (
  timestamp: string,
  prefix: string,
  message: string,
  meta?: Record<string, unknown>,
) => {
  if (!meta || Object.keys(meta).length === 0) {
    return `${timestamp} ${prefix} ${message}`;
  }
  return `${timestamp} ${prefix} ${message} ${JSON.stringify(meta)}`;
};

export const createDebugLogger = (options: DebugLoggerOptions = {}): DebugLogger => {
  const env = resolveEnv();
  const enabled =
    options.enabled ??
    (parseEnabled(env.TRANSLOADIT_DEBUG) || parseEnabled(env.CONVEX_TRANSLOADIT_DEBUG));
  const namespace = options.namespace ?? 'convex';
  const prefix = `[transloadit:${namespace}]`;
  const sink: ConsoleSink = options.sink ?? console;
  const clock = options.clock ?? (() => new Date());

  const emit = (
    level: 'log' | 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    if (!enabled) return;
    const line = formatLine(clock().toISOString(), prefix, message, meta);
    sink[level](line);
  };

  const logger: DebugLogger = {
    enabled,
    log: (message, meta) => emit('log', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
    event: (name, meta) => emit('info', `event:${name}`, meta),
    child: (childNamespace) =>
      createDebugLogger({
        ...options,
        namespace: `${namespace}:${childNamespace}`,
        enabled,
      }),
  };

  return logger;
};
