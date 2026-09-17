// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { WeddingLayout } from './WeddingLayout'

vi.mock('next/dynamic', () => ({ default: () => () => null }))

// JSDOM does not implement the browser's modal/top-layer behavior.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true
}
HTMLDialogElement.prototype.close = function () {
  this.open = false
}

afterEach(cleanup)

const props: ComponentProps<typeof WeddingLayout> = {
  uppy: {} as ComponentProps<typeof WeddingLayout>['uppy'],
  guestName: 'Guest',
  onGuestNameChange: vi.fn(),
  uploadCode: '',
  onUploadCodeChange: vi.fn(),
  isUploading: true,
  onUpload: vi.fn(),
  error: null,
  assemblyId: null,
  assemblyParams: null,
  status: 'uploading',
  stage: 'uploading',
  children: <p>The album</p>,
}

test('keeps failed uploads discoverable after guests close the uploader to browse', () => {
  const { rerender } = render(<WeddingLayout {...props} />)
  fireEvent.click(screen.getByTestId('open-upload'))
  fireEvent.click(screen.getByRole('button', { name: 'Close upload' }))
  rerender(<WeddingLayout {...props} isUploading={false} stage="error" error="Connection lost" />)

  fireEvent.click(screen.getByRole('button', { name: 'Upload failed · Retry' }))
  const dialog = screen.getByRole('dialog', { name: 'Share your memories' })
  expect(within(dialog).getByRole('alert').textContent).toBe('Connection lost')
  fireEvent.click(within(dialog).getByTestId('start-upload'))
  expect(props.onUpload).toHaveBeenCalledOnce()
})

test('delivers new notifications inside the active upload dialog', () => {
  const { rerender } = render(<WeddingLayout {...props} />)
  fireEvent.click(screen.getByTestId('open-upload'))
  rerender(
    <WeddingLayout {...props} toasts={[{ id: 'uploaded', message: 'Alex uploaded 3 files' }]} />,
  )
  const dialog = screen.getByRole('dialog', { name: 'Share your memories' })
  expect(within(dialog).getByText('Alex uploaded 3 files')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close upload' }))
  expect(screen.getByText('Alex uploaded 3 files').closest('dialog')).toBeNull()
})
