// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { createWeddingUppy } from './createWeddingUppy'

const sign = vi.fn(async () => ({ params: '{}', signature: 'test-signature' }))
let uploader: ReturnType<typeof createWeddingUppy> | undefined

afterEach(() => {
  uploader?.uppy.destroy()
  uploader = undefined
  vi.clearAllMocks()
})

test('rejects an empty photo through Uppy before requesting an Assembly', () => {
  uploader = createWeddingUppy(sign)
  const rejected = vi.fn()
  uploader.uppy.on('restriction-failed', rejected)
  expect(() =>
    uploader?.uppy.addFile({ name: 'empty.jpg', type: 'image/jpeg', data: new Blob([]) }),
  ).toThrow()
  expect(rejected).toHaveBeenCalledOnce()
  expect(uploader.uppy.getFiles()).toHaveLength(0)
  expect(sign).not.toHaveBeenCalled()
})

test('keeps nonempty photos and videos selectable without starting an upload', () => {
  uploader = createWeddingUppy(sign)
  uploader.uppy.addFile({
    name: 'photo.jpg',
    type: 'image/jpeg',
    data: new Blob(['test photo']),
  })
  uploader.uppy.addFile({
    name: 'video.mp4',
    type: 'video/mp4',
    data: new Blob(['test video']),
  })
  expect(uploader.uppy.getFiles()).toHaveLength(2)
  expect(sign).not.toHaveBeenCalled()
})
