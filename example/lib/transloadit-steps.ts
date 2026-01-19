import {
  type RobotCloudflareStoreInstructions,
  robotCloudflareStoreInstructionsSchema,
} from "@transloadit/zod/v3/robots/cloudflare-store";
import {
  type RobotFileFilterInstructions,
  robotFileFilterInstructionsSchema,
} from "@transloadit/zod/v3/robots/file-filter";
import {
  type RobotImageResizeInstructions,
  robotImageResizeInstructionsSchema,
} from "@transloadit/zod/v3/robots/image-resize";
import {
  type RobotUploadHandleInstructions,
  robotUploadHandleInstructionsSchema,
} from "@transloadit/zod/v3/robots/upload-handle";
import {
  type RobotVideoEncodeInstructions,
  robotVideoEncodeInstructionsSchema,
} from "@transloadit/zod/v3/robots/video-encode";
import { z } from "zod/v3";

type TransloaditSteps = Record<string, Record<string, unknown>>;

const tpl = (value: string) => `$${"{"}${value}}`;

const r2EnvSchema = z.object({
  TRANSLOADIT_R2_CREDENTIALS: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_HOST: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
});

type R2Config = {
  credentials?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  host?: string;
  urlPrefix?: string;
};

const readR2Config = (): R2Config => {
  const env = r2EnvSchema.parse(process.env);
  const normalizeHost = (value?: string) => {
    if (!value) return undefined;
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }
    return `https://${value}`;
  };
  const normalizeUrlPrefix = (value?: string) => {
    if (!value) return undefined;
    return value.endsWith("/") ? value : `${value}/`;
  };
  const host = normalizeHost(
    env.R2_HOST ??
      (env.R2_ACCOUNT_ID
        ? `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined),
  );

  if (env.TRANSLOADIT_R2_CREDENTIALS) {
    return {
      credentials: env.TRANSLOADIT_R2_CREDENTIALS,
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      host,
      urlPrefix: normalizeUrlPrefix(env.R2_PUBLIC_URL),
    };
  }

  if (!env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "Missing R2 credentials. Set TRANSLOADIT_R2_CREDENTIALS or provide R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
    );
  }
  if (!host) {
    throw new Error("Missing R2 host. Set R2_HOST or R2_ACCOUNT_ID.");
  }

  return {
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    host,
    urlPrefix: normalizeUrlPrefix(env.R2_PUBLIC_URL),
  };
};

const buildStoreStep = (
  use: string,
  r2: R2Config,
): RobotCloudflareStoreInstructions => {
  const step: RobotCloudflareStoreInstructions = {
    robot: "/cloudflare/store",
    use,
    result: true,
    credentials: r2.credentials,
    bucket: r2.bucket,
    key: r2.accessKeyId,
    secret: r2.secretAccessKey,
    host: r2.host,
    url_prefix: r2.urlPrefix,
    path: `wedding/${tpl("fields.album")}/${tpl("unique_prefix")}/${tpl(
      "file.url_name",
    )}`,
  };
  robotCloudflareStoreInstructionsSchema.parse(step);
  return step;
};

const buildUploadStep = (): RobotUploadHandleInstructions => {
  const step: RobotUploadHandleInstructions = {
    robot: "/upload/handle",
  };
  robotUploadHandleInstructionsSchema.parse(step);
  return step;
};

const buildFilterStep = (
  use: string,
  pattern: string,
): RobotFileFilterInstructions => {
  const step: RobotFileFilterInstructions = {
    robot: "/file/filter",
    use,
    accepts: [[tpl("file.mime"), "regex", pattern]],
    error_on_decline: false,
  };
  robotFileFilterInstructionsSchema.parse(step);
  return step;
};

const buildResizeStep = (use: string): RobotImageResizeInstructions => {
  const step: RobotImageResizeInstructions = {
    robot: "/image/resize",
    use,
    width: 1600,
    height: 1600,
    resize_strategy: "fit",
  };
  robotImageResizeInstructionsSchema.parse(step);
  return step;
};

const buildVideoStep = (use: string): RobotVideoEncodeInstructions => {
  const step: RobotVideoEncodeInstructions = {
    robot: "/video/encode",
    use,
    preset: "ipad-high",
  };
  robotVideoEncodeInstructionsSchema.parse(step);
  return step;
};

export const buildWeddingSteps = (): TransloaditSteps => {
  const r2 = readR2Config();

  return {
    ":original": buildUploadStep(),
    images_filtered: buildFilterStep(":original", "^image"),
    videos_filtered: buildFilterStep(":original", "^video"),
    images_resized: buildResizeStep("images_filtered"),
    videos_encoded: buildVideoStep("videos_filtered"),
    images_output: buildStoreStep("images_resized", r2),
    videos_output: buildStoreStep("videos_encoded", r2),
  };
};
