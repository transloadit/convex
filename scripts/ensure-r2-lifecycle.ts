import {
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadEnv } from './env.ts';

loadEnv();

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
};

const retentionDays = Number(process.env.R2_RETENTION_DAYS ? process.env.R2_RETENTION_DAYS : '1');
if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
  throw new Error('R2_RETENTION_DAYS must be a positive number');
}

const r2Bucket = requireEnv('R2_BUCKET');
const r2AccessKeyId = requireEnv('R2_ACCESS_KEY_ID');
const r2SecretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
const r2Host =
  process.env.R2_HOST ||
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : '');
if (!r2Host) {
  throw new Error('Missing R2_HOST or R2_ACCOUNT_ID environment variable');
}
const r2Endpoint = r2Host.startsWith('http') ? r2Host : `https://${r2Host}`;

const client = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
});

const desiredRuleId = 'expire-demo-objects';

const buildRules = (): LifecycleRule[] => [
  {
    ID: desiredRuleId,
    Status: 'Enabled',
    Filter: { Prefix: '' },
    Expiration: { Days: retentionDays },
  },
];

const run = async () => {
  let currentRules: unknown[] = [];
  try {
    const current = await client.send(
      new GetBucketLifecycleConfigurationCommand({
        Bucket: r2Bucket,
      }),
    );
    currentRules = current.Rules ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('NoSuchLifecycleConfiguration')) {
      throw error;
    }
  }

  const desiredRules = buildRules();

  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: r2Bucket,
      LifecycleConfiguration: {
        Rules: desiredRules,
      },
    }),
  );

  console.log(
    JSON.stringify(
      {
        bucket: r2Bucket,
        retentionDays,
        previousRules: currentRules,
        appliedRules: desiredRules,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
