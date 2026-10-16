// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
import { useWeddingUppy } from './useWeddingUppy'

const { create, destroy, setOptions } = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  setOptions: vi.fn(),
}))
vi.mock('./createWeddingUppy', () => ({ createWeddingUppy: create }))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function LazyUploader() {
  const [requested, setRequested] = useState(false)
  const [open, setOpen] = useState(false)
  const { uppy, failed } = useWeddingUppy(
    async () => ({ params: '{}', signature: 'test-signature' }),
    requested,
  )
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRequested(true)
          setOpen(!open)
        }}
      >
        Toggle uploader
      </button>
      <p>{failed ? 'Failed' : uppy ? 'Ready' : 'Not ready'}</p>
      {open ? <p>Open</p> : null}
    </>
  )
}

test('loads once on demand, survives close/reopen and destroys the instance on guest exit', async () => {
  create.mockReturnValue({ uppy: { destroy, setOptions }, locales: { en: {} } })
  const { unmount } = render(
    <StrictMode>
      <AlbumIntlProvider initialLocale="en">
        <LazyUploader />
      </AlbumIntlProvider>
    </StrictMode>,
  )
  expect(create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button'))
  await screen.findByText('Ready')
  expect(create).toHaveBeenCalledOnce()
  await waitFor(() => expect(setOptions).toHaveBeenCalledWith({ locale: {} }))
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('button'))
  expect(create).toHaveBeenCalledOnce()
  expect(destroy).not.toHaveBeenCalled()
  unmount()
  expect(destroy).toHaveBeenCalledOnce()
})

test('leaving before the chunk resolves creates no orphan uploader', async () => {
  const { unmount } = render(
    <AlbumIntlProvider initialLocale="en">
      <LazyUploader />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button'))
  unmount()
  await act(async () => {})
  expect(create).not.toHaveBeenCalled()
})

test('surfaces a failed uploader initialization without an unhandled rejection', async () => {
  create.mockImplementation(() => {
    throw new Error('Initialization failed')
  })
  render(
    <AlbumIntlProvider initialLocale="en">
      <LazyUploader />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(screen.getByText('Failed')).toBeTruthy())
})
