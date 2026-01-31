export type R2Config = {
  credentials?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  host?: string;
  urlPrefix?: string;
};

const clean = (value?: string) => value?.trim() || undefined;

const normalizeHost = (value?: string) => {
  if (!value) return undefined;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `https://${value}`;
};

const normalizeUrlPrefix = (value?: string) => {
  if (!value) return undefined;
  return value.endsWith('/') ? value : `${value}/`;
};

export const readR2ConfigFromEnv = (env: NodeJS.ProcessEnv): R2Config => {
  const credentials = clean(env.TRANSLOADIT_R2_CREDENTIALS);
  const bucket = clean(env.R2_BUCKET);
  const accessKeyId = clean(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.R2_SECRET_ACCESS_KEY);
  const accountId = clean(env.R2_ACCOUNT_ID);
  const hostValue = clean(env.R2_HOST);
  const publicUrl = clean(env.R2_PUBLIC_URL);
  const host = normalizeHost(
    hostValue ?? (accountId ? `${accountId}.r2.cloudflarestorage.com` : undefined),
  );

  if (credentials) {
    return {
      credentials,
      bucket,
      accessKeyId,
      secretAccessKey,
      host,
      urlPrefix: normalizeUrlPrefix(publicUrl),
    };
  }

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing R2 credentials. Set TRANSLOADIT_R2_CREDENTIALS or provide R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.',
    );
  }
  if (!host) {
    throw new Error('Missing R2 host. Set R2_HOST or R2_ACCOUNT_ID.');
  }

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    host,
    urlPrefix: normalizeUrlPrefix(publicUrl),
  };
};
