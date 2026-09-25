import { describe, expect, test } from 'vitest'
import {
  buildGalleryItems,
  buildStorageGalleryItems,
  mergeGalleryItems,
  type StorageGalleryAsset,
  thumbnailSizes,
} from './gallery'
import type { AssemblyResultResponse } from './transloadit'

const result = (
  stepName: string,
  overrides: Partial<AssemblyResultResponse> = {},
): AssemblyResultResponse => ({
  _id: 'result',
  _creationTime: 1000,
  assemblyId: 'first',
  stepName,
  sslUrl: `https://example.com/${stepName}`,
  name: 'photo.jpg',
  createdAt: 1000,
  raw: { original_id: 'original' },
  ...overrides,
})

describe('gallery media', () => {
  test.each([{}, { original_basename: 'photo.jpg' }, { original_id: [] }])(
    'does not hide same-named uploads without reliable original IDs (%j)',
    (raw) => {
      const items = buildGalleryItems(
        [
          result('images_output', { _id: 'first-result', raw }),
          result('images_output', { _id: 'second-result', raw }),
        ],
        { now: 1000 },
      )
      expect(items).toHaveLength(2)
      expect(items[0]?.id).not.toBe(items[1]?.id)
    },
  )

  test('normalizes array source IDs while preserving different uploads with the same name', () => {
    const items = buildGalleryItems(
      [
        result('images_resized', { raw: { original_id: ['first'] } }),
        result('images_output', { raw: { original_id: ['first'] } }),
        result('images_output', { raw: { original_id: ['second'] } }),
      ],
      { now: 1000 },
    )
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.url?.endsWith('images_output'))).toBe(true)
  })

  test.each([false, true])(
    'prefers permanent exports regardless of result order (%s)',
    (reverse) => {
      const results = [result('images_resized'), result('images_output')]
      const items = buildGalleryItems(reverse ? results.reverse() : results, { now: 1000 })
      expect(items).toHaveLength(1)
      expect(items[0]?.url).toBe('https://example.com/images_output')
    },
  )

  test('keeps legacy results visible and ignores unknown steps or missing URLs', () => {
    const items = buildGalleryItems(
      [
        result('images_resized'),
        result('originals'),
        result('videos_output', { sslUrl: undefined }),
      ],
      { now: 1000 },
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('image')
  })

  test('associates persistent video posters within the same Assembly', () => {
    const items = buildGalleryItems(
      [
        result('videos_output'),
        result('videos_thumbs_output'),
        result('videos_thumbs'),
        result('videos_output', { assemblyId: 'second' }),
        result('videos_thumbs_output', {
          assemblyId: 'second',
          sslUrl: 'https://example.com/second',
        }),
      ],
      { now: 1000 },
    )
    expect(items.map((item) => item.posterUrl)).toEqual([
      'https://example.com/videos_thumbs_output',
      'https://example.com/second',
    ])
  })

  test('applies the retention boundary and can disable the UI cutoff', () => {
    const results = [result('images_output')]
    expect(buildGalleryItems(results, { now: 2000, retentionMs: 1000 })).toEqual([])
    expect(buildGalleryItems(results, { now: 2000, retentionMs: Infinity })).toHaveLength(1)
  })
})

const stored = (
  id: string,
  createdAt: number,
  overrides: Partial<StorageGalleryAsset['asset']> = {},
) => ({
  id,
  assemblyId: `assembly-${id}`,
  uploadedBy: 'Alex',
  createdAt,
  asset: {
    workspace: 'open-test-prod',
    asset_id: `${id.padEnd(21, 'x')}A`,
    version_id: `${id.padEnd(21, 'y')}A`,
    path: `convex-demo/local/wedding-gallery/upload/${id}.jpg`,
    size: 1,
    mime: 'image/jpeg',
    width: 1600,
    height: 1000,
    ...overrides,
  },
})

describe('private Storage photos', () => {
  test('render from receipts with their credited guest, never from a URL', () => {
    const [item] = buildStorageGalleryItems([stored('a', 1000)], { now: 1000 })
    expect(item).toMatchObject({
      id: 'storage:a',
      name: 'a.jpg',
      kind: 'image',
      aspectRatio: 1.6,
      uploadedBy: 'Alex',
      receipt: { asset_id: stored('a', 0).asset.asset_id, width: 1600, height: 1000 },
    })
    expect(item?.url).toBeUndefined()
  })

  test('apply the retention boundary and skip receipts without image geometry', () => {
    const assets = [stored('old', 0), stored('clip', 1500, { width: undefined, mime: 'video/mp4' })]
    expect(buildStorageGalleryItems(assets, { now: 2000, retentionMs: 1000 })).toEqual([])
  })

  test('merge with R2 media newest first, keeping the incoming order for equal times', () => {
    const photos = buildStorageGalleryItems([stored('new', 3000), stored('same', 1000)], {
      now: 3000,
    })
    const videos = buildGalleryItems([result('videos_output', { createdAt: 2000 })], { now: 3000 })
    expect(mergeGalleryItems(photos, videos).map((item) => item.id)).toEqual([
      'storage:new',
      videos[0]?.id,
      'storage:same',
    ])
  })
})

test('thumbnail sizes follow the justified row layout, without auto sizing', () => {
  expect(thumbnailSizes(3 / 2)).toBe('(max-width: 640px) 100vw, 469px')
  expect(thumbnailSizes(2 / 3)).toBe('(max-width: 640px) 100vw, 208px')
  expect(thumbnailSizes()).toBe(thumbnailSizes(3 / 2))
})
