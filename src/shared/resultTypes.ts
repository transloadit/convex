import type { AssemblyStatusResult } from "@transloadit/zod/v3/assemblyStatus";

export type TransloaditResult = AssemblyStatusResult;

export type ImageResizeResult = AssemblyStatusResult & {
  ssl_url?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  size?: number | null;
};

export type VideoEncodeResult = AssemblyStatusResult & {
  ssl_url?: string | null;
  url?: string | null;
  duration?: number | null;
  streaming_url?: string;
  hls_url?: string;
};

export type VideoThumbsResult = AssemblyStatusResult & {
  ssl_url?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
};

export type StoreResult = AssemblyStatusResult & {
  ssl_url?: string | null;
  url?: string | null;
  storage_url?: string;
};

export type ResultByRobot = {
  "/image/resize": ImageResizeResult;
  "/video/encode": VideoEncodeResult;
  "/video/thumbs": VideoThumbsResult;
  "/r2/store": StoreResult;
  "/s3/store": StoreResult;
};

export type ResultForRobot<Robot extends keyof ResultByRobot> =
  ResultByRobot[Robot];
