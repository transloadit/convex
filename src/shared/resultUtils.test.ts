import { describe, expect, it } from 'vitest'
import { getResultOriginalKey, getResultUrl } from './resultUtils.ts'

describe('result utils', () => {
  it('normalizes supported array original IDs', () => {
    expect(getResultOriginalKey({ raw: { original_id: ['first'] } })).toBe('first')
    expect(getResultOriginalKey({ raw: { original_id: ['first', 'second'] } })).toBe(
      '["first","second"]',
    )
  })

  it('can require reliable source identity rather than a shared filename', () => {
    expect(
      getResultOriginalKey(
        { raw: { original_basename: 'photo.jpg' }, name: 'photo.jpg', _id: 'result' },
        { allowNameFallback: false },
      ),
    ).toBeNull()
  })

  it('extracts result URLs with common fallbacks', () => {
    expect(getResultUrl({ ssl_url: 'https://cdn.example.com/file.jpg' })).toBe(
      'https://cdn.example.com/file.jpg',
    )
    expect(
      getResultUrl({
        meta: { url: 'https://cdn.example.com/meta.jpg' },
      }),
    ).toBe('https://cdn.example.com/meta.jpg')
  })

  it('derives original keys from raw metadata', () => {
    expect(
      getResultOriginalKey({
        raw: { original_id: 'orig_1' },
      }),
    ).toBe('orig_1')
    expect(
      getResultOriginalKey({
        raw: { original_basename: 'photo.jpg' },
      }),
    ).toBe('photo.jpg')
    expect(getResultOriginalKey({ name: 'fallback.jpg' })).toBe('fallback.jpg')
  })
})
