import { describe, expect, test } from 'vitest'
import { buildGalleryItems } from './gallery'
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
    expect(items.every((item) => item.url.endsWith('images_output'))).toBe(true)
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
