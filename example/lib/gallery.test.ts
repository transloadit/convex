import { describe, expect, test } from 'vitest'
import { buildStorageGalleryItems, type StorageGalleryAsset, thumbnailSizes } from './gallery'

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
  test('video playback and poster use private delivery while download selects the original', () => {
    const original = stored('clip', 1000, { mime: 'video/quicktime', path: 'album/clip.mov' })
    const video = stored('mp4', 1000, { mime: 'video/mp4' }).asset
    const poster = stored('poster', 1000).asset
    const [item] = buildStorageGalleryItems([{ ...original, video, poster }], { now: 1000 })
    expect(item).toMatchObject({
      kind: 'video',
      name: 'clip.mov',
      original: original.asset,
      video,
      poster,
    })
    expect(item?.receipt).toBeUndefined()
  })

  test('video cards use the playback dimensions when an encoder rotates a phone original', () => {
    const original = stored('phone', 1000, {
      mime: 'video/quicktime',
      width: 1920,
      height: 1080,
    })
    const video = stored('mp4', 1000, {
      mime: 'video/mp4',
      width: 1080,
      height: 1920,
    }).asset
    const [item] = buildStorageGalleryItems([{ ...original, video }], { now: 1000 })
    expect(item?.aspectRatio).toBe(1080 / 1920)
    expect(item?.original).toEqual(original.asset)
  })

  test('render from receipts with their credited guest, never from a URL', () => {
    const [item] = buildStorageGalleryItems([stored('a', 1000)], { now: 1000 })
    expect(item).toMatchObject({
      id: `${stored('a', 0).asset.asset_id}.${stored('a', 0).asset.version_id}`,
      name: 'a.jpg',
      kind: 'image',
      aspectRatio: 1.6,
      uploadedBy: 'Alex',
      receipt: { asset_id: stored('a', 0).asset.asset_id, width: 1600, height: 1000 },
    })
    expect(item).not.toHaveProperty('url')
  })

  test('apply the retention boundary and skip receipts without image geometry', () => {
    const assets = [stored('old', 0), stored('raw', 1500, { width: undefined })]
    expect(buildStorageGalleryItems(assets, { now: 2000, retentionMs: 1000 })).toEqual([])
  })
})

test('thumbnail sizes follow the justified row layout, without auto sizing', () => {
  expect(thumbnailSizes(3 / 2)).toBe('(max-width: 640px) 100vw, 469px')
  expect(thumbnailSizes(2 / 3)).toBe('(max-width: 640px) 100vw, 208px')
  expect(thumbnailSizes()).toBe(thumbnailSizes(3 / 2))
})
