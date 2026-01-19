type R2Config = {
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  host?: string;
  urlPrefix?: string;
  credentials?: string;
};

type TransloaditSteps = Record<string, Record<string, unknown>>;

const tpl = (value: string) => `$${"{"}${value}}`;

const readR2Config = (): R2Config | null => {
  const credentials = process.env.TRANSLOADIT_R2_CREDENTIALS;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  const host =
    process.env.R2_HOST ??
    (accountId ? `${accountId}.r2.cloudflarestorage.com` : "");
  const urlPrefix = process.env.R2_PUBLIC_URL;

  if (credentials) {
    return {
      bucket: bucket ?? undefined,
      accessKeyId: accessKeyId ?? undefined,
      secretAccessKey: secretAccessKey ?? undefined,
      host: host || undefined,
      urlPrefix: urlPrefix ?? undefined,
      credentials,
    };
  }

  const anySet = Boolean(
    bucket || accessKeyId || secretAccessKey || host || urlPrefix,
  );
  if (!anySet) return null;

  if (!bucket || !accessKeyId || !secretAccessKey || !host) {
    throw new Error(
      "Missing R2 configuration. Provide R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_HOST (or R2_ACCOUNT_ID).",
    );
  }

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    host,
    urlPrefix: urlPrefix ?? undefined,
  };
};

const buildStoreStep = (use: string, r2: R2Config) => {
  const step: Record<string, unknown> = {
    robot: "/cloudflare/store",
    use,
    result: true,
    path: `wedding/${tpl("fields.album")}/${tpl("unique_prefix")}/${tpl(
      "file.url_name",
    )}`,
  };

  if (r2.credentials) {
    step.credentials = r2.credentials;
  } else {
    step.bucket = r2.bucket;
    step.key = r2.accessKeyId;
    step.secret = r2.secretAccessKey;
    step.host = r2.host;
  }
  if (r2.urlPrefix) {
    step.url_prefix = r2.urlPrefix;
  }

  return step;
};

export const buildWeddingSteps = (): TransloaditSteps => {
  const r2 = readR2Config();

  const steps: TransloaditSteps = {
    ":original": {
      robot: "/upload/handle",
    },
    images_filtered: {
      use: ":original",
      robot: "/file/filter",
      accepts: [["$" + "{file.mime}", "regex", "^image"]],
      error_on_decline: false,
    },
    videos_filtered: {
      use: ":original",
      robot: "/file/filter",
      accepts: [["$" + "{file.mime}", "regex", "^video"]],
      error_on_decline: false,
    },
  };

  if (r2) {
    steps.images_resized = {
      use: "images_filtered",
      robot: "/image/resize",
      width: 1600,
      height: 1600,
      resize_strategy: "fit",
    };
    steps.videos_encoded = {
      use: "videos_filtered",
      robot: "/video/encode",
      preset: "ipad-high",
    };
    steps.images_output = buildStoreStep("images_resized", r2);
    steps.videos_output = buildStoreStep("videos_encoded", r2);
    return steps;
  }

  steps.images_output = {
    use: "images_filtered",
    robot: "/image/resize",
    width: 1600,
    height: 1600,
    resize_strategy: "fit",
    result: true,
  };
  steps.videos_output = {
    use: "videos_filtered",
    robot: "/video/encode",
    preset: "ipad-high",
    result: true,
  };

  return steps;
};
