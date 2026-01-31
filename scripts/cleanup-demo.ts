import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { ConvexHttpClient } from 'convex/browser';
import { loadEnv } from './env.ts';

loadEnv();

const argMap = new Map<string, string | boolean>();
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') {
    argMap.set('dry-run', true);
    continue;
  }
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    if (key) {
      argMap.set(key, value ?? '');
    }
  }
}

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
};

const album =
  (argMap.get('album') as string | undefined) || process.env.DEMO_ALBUM || 'wedding-gallery';
const prefix = (argMap.get('prefix') as string | undefined) || `wedding/${album}/`;
const dryRun = argMap.get('dry-run') === true;

const convexUrl = requireEnv('CONVEX_URL');
const convexAdminKey = requireEnv('CONVEX_ADMIN_KEY');

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

const client = new ConvexHttpClient(convexUrl, {
  logger: false,
}) as ConvexHttpClient & {
  setAdminAuth: (token: string) => void;
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};
client.setAdminAuth(convexAdminKey);

const deleteFromConvex = async () => {
  const result = (await client.mutation('transloadit:purgeAlbum', {
    album,
    deleteAssemblies: true,
  })) as { deletedResults: number; deletedAssemblies: number };
  return result;
};

const deleteFromR2 = async () => {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
  });

  let deleted = 0;
  let continuationToken: string | undefined;
  const toDelete: { Key: string }[] = [];

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: r2Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = response.Contents ?? [];
    for (const entry of keys) {
      if (entry.Key) {
        toDelete.push({ Key: entry.Key });
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (dryRun) {
    return { deleted: 0, queued: toDelete.length };
  }

  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: r2Bucket,
        Delete: { Objects: batch },
      }),
    );
    deleted += batch.length;
  }

  return { deleted, queued: toDelete.length };
};

const run = async () => {
  const convexResult = await deleteFromConvex();
  const r2Result = await deleteFromR2();

  console.log(
    JSON.stringify(
      {
        album,
        prefix,
        dryRun,
        convex: convexResult,
        r2: r2Result,
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
