// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import Uppy from '@uppy/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAssemblyEvents, type WeddingUppy } from './useWeddingUppy'

let uppy: WeddingUppy
const assembly = { assembly_id: 'test-assembly', ok: 'ASSEMBLY_UPLOADING' } as const

beforeEach(() => {
  uppy = new Uppy()
})

afterEach(() => {
  cleanup()
  uppy.destroy()
})

test('shows processing when encoding starts, not when the Assembly has already finished', () => {
  const setAssemblyId = vi.fn()
  const setStage = vi.fn()
  renderHook(() => useAssemblyEvents(uppy, setAssemblyId, setStage))

  act(() => uppy.emit('transloadit:assembly-created', assembly, []))
  expect(setAssemblyId).toHaveBeenCalledWith('test-assembly')
  expect(setStage).toHaveBeenLastCalledWith('uploading')
  act(() => uppy.emit('transloadit:assembly-executing', assembly))
  expect(setStage).toHaveBeenLastCalledWith('processing')

  setStage.mockClear()
  act(() => uppy.emit('transloadit:complete', { ...assembly, ok: 'ASSEMBLY_COMPLETED' }))
  // The upload promise and persisted status own completion and the album reveal.
  expect(setStage).not.toHaveBeenCalled()
})

test('an Assembly error stays failed when the plugin subsequently emits complete', () => {
  const setStage = vi.fn()
  renderHook(() => useAssemblyEvents(uppy, vi.fn(), setStage))
  act(() => uppy.emit('transloadit:assembly-created', assembly, []))
  act(() => uppy.emit('transloadit:assembly-error', assembly, new Error('Encoding failed')))
  expect(setStage).toHaveBeenLastCalledWith('error')

  setStage.mockClear()
  act(() => uppy.emit('transloadit:complete', { error: 'VIDEO_ENCODE_VALIDATION' }))
  expect(setStage).not.toHaveBeenCalled()
})

test('removes event handlers when the uploader leaves the page', () => {
  const setStage = vi.fn()
  const { unmount } = renderHook(() => useAssemblyEvents(uppy, vi.fn(), setStage))
  unmount()
  act(() => uppy.emit('transloadit:assembly-created', assembly, []))
  act(() => uppy.emit('transloadit:assembly-executing', assembly))
  act(() => uppy.emit('transloadit:assembly-error', assembly, new Error('Encoding failed')))
  expect(setStage).not.toHaveBeenCalled()
})
