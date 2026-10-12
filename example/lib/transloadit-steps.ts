import { robotTransloaditStoreInstructionsSchema } from '@transloadit/zod/v3/robots/transloadit-store'

/** Reusable processing Template. Storage destinations are supplied by the signing server. */
export const weddingProcessingSteps = {
  ':original': { robot: '/upload/handle', output_meta: { thumbhash: true } },
  video_input: {
    robot: '/file/filter',
    use: ':original',
    accepts: [['${file.mime}', 'regex', '^video/']],
    error_on_decline: false,
    result: false,
  },
  video_encode: {
    robot: '/video/encode',
    use: 'video_input',
    preset: 'ipad-high',
    // Storage receipts retain the producing Step's name and visibility flag.
    result: true,
  },
  video_poster: {
    robot: '/video/thumbs',
    use: 'video_input',
    count: 1,
    format: 'jpg',
    width: 640,
    output_meta: { thumbhash: true },
    result: true,
  },
}

/**
 * All original bytes and video renditions use private Storage. Never interpolate a destination
 * from Assembly fields: unsigned multipart fields can override even signed params.fields.
 * A saved processing Template removes the processing instructions, not the signed destination.
 */
export const buildWeddingSteps = ({
  storagePrefix,
  templateId,
}: {
  storagePrefix: string
  templateId?: string
}) => {
  const store = (use: string, name: string) =>
    robotTransloaditStoreInstructionsSchema.parse({
      robot: '/transloadit/store',
      use,
      path: `${storagePrefix}${name}`,
      conflict_strategy: 'rename',
      result: true,
    })
  return {
    ...(templateId ? {} : weddingProcessingSteps),
    // Direct :original storage also avoids transforming Community-plan originals; a type filter
    // in front would watermark them again. Uppy's type limit is browser-only, but admitted guests
    // can already store large videos within the same signed file count. Other files are never
    // listed or delivered (media.ts) and expire with the album like everything else.
    originals_stored: store(':original', '${file.url_name}'),
    videos_stored: store('video_encode', 'play-${file.id}.mp4'),
    posters_stored: store('video_poster', 'poster-${file.id}.jpg'),
  }
}
