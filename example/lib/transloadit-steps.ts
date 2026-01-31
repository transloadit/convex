import { robotCloudflareStoreInstructionsSchema } from '@transloadit/zod/v3/robots/cloudflare-store';
import { robotFileFilterInstructionsSchema } from '@transloadit/zod/v3/robots/file-filter';
import { robotImageResizeInstructionsSchema } from '@transloadit/zod/v3/robots/image-resize';
import { robotUploadHandleInstructionsSchema } from '@transloadit/zod/v3/robots/upload-handle';
import { robotVideoEncodeInstructionsSchema } from '@transloadit/zod/v3/robots/video-encode';
import { robotVideoThumbsInstructionsSchema } from '@transloadit/zod/v3/robots/video-thumbs';
import type { z } from 'zod/v3';
import { type R2Config, readR2ConfigFromEnv } from './r2';

type TransloaditSteps = Record<string, Record<string, unknown>>;

// biome-ignore lint/style/useTemplate: Template literals emit invalid `${${...}}` in Next build output.
const tpl = (value: string) => '$' + '{' + value + '}';

type RobotCloudflareStoreInput = z.input<typeof robotCloudflareStoreInstructionsSchema>;
type RobotFileFilterInput = z.input<typeof robotFileFilterInstructionsSchema>;
type RobotImageResizeInput = z.input<typeof robotImageResizeInstructionsSchema>;
type RobotUploadHandleInput = z.input<typeof robotUploadHandleInstructionsSchema>;
type RobotVideoEncodeInput = z.input<typeof robotVideoEncodeInstructionsSchema>;
type RobotVideoThumbsInput = z.input<typeof robotVideoThumbsInstructionsSchema>;

const buildStoreStep = (use: string, r2: R2Config): RobotCloudflareStoreInput => {
  const step: RobotCloudflareStoreInput = {
    robot: '/cloudflare/store',
    use,
    result: true,
    credentials: r2.credentials,
    bucket: r2.bucket,
    key: r2.accessKeyId,
    secret: r2.secretAccessKey,
    host: r2.host,
    url_prefix: r2.urlPrefix,
    path: `wedding/${tpl('fields.album')}/${tpl('unique_prefix')}/${tpl('file.url_name')}`,
  };
  robotCloudflareStoreInstructionsSchema.parse(step);
  return step;
};

const buildUploadStep = (): RobotUploadHandleInput => {
  const step: RobotUploadHandleInput = {
    robot: '/upload/handle',
  };
  robotUploadHandleInstructionsSchema.parse(step);
  return step;
};

const buildFilterStep = (use: string, pattern: string): RobotFileFilterInput => {
  const step: RobotFileFilterInput = {
    robot: '/file/filter',
    use,
    accepts: [[tpl('file.mime'), 'regex', pattern]],
    error_on_decline: false,
  };
  robotFileFilterInstructionsSchema.parse(step);
  return step;
};

const buildResizeStep = (use: string): RobotImageResizeInput => {
  const step: RobotImageResizeInput = {
    robot: '/image/resize',
    use,
    width: 1600,
    height: 1600,
    resize_strategy: 'fit',
  };
  robotImageResizeInstructionsSchema.parse(step);
  return step;
};

const buildVideoStep = (use: string): RobotVideoEncodeInput => {
  const step: RobotVideoEncodeInput = {
    robot: '/video/encode',
    use,
    preset: 'ipad-high',
  };
  robotVideoEncodeInstructionsSchema.parse(step);
  return step;
};

const buildVideoThumbsStep = (use: string): RobotVideoThumbsInput => {
  const step: RobotVideoThumbsInput = {
    robot: '/video/thumbs',
    use,
    count: 1,
    format: 'jpg',
    width: 640,
  };
  robotVideoThumbsInstructionsSchema.parse(step);
  return step;
};

export const buildWeddingSteps = (): TransloaditSteps => {
  const r2 = readR2ConfigFromEnv(process.env);

  return {
    ':original': buildUploadStep(),
    images_filtered: buildFilterStep(':original', '^image'),
    videos_filtered: buildFilterStep(':original', '^video'),
    images_resized: buildResizeStep('images_filtered'),
    videos_thumbs: buildVideoThumbsStep('videos_filtered'),
    videos_encoded: buildVideoStep('videos_filtered'),
    images_output: buildStoreStep('images_resized', r2),
    videos_thumbs_output: buildStoreStep('videos_thumbs', r2),
    videos_output: buildStoreStep('videos_encoded', r2),
  };
};
