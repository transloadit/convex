// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
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
  guestName: 'Alex',
  onGuestNameChange: vi.fn(),
  onLeave: vi.fn(),
  isUploading: true,
  onUpload: vi.fn(),
  error: null,
  assemblyId: null,
  assemblyParams: null,
  status: 'uploading',
  stage: 'uploading',
  children: <p>The album</p>,
}

const Album = (overrides: Partial<ComponentProps<typeof WeddingLayout>>) => (
  <AlbumIntlProvider initialLocale="en">
    <WeddingLayout {...props} {...overrides} />
  </AlbumIntlProvider>
)

test('keeps failed uploads discoverable after guests close the uploader to browse', () => {
  const { rerender } = render(<Album />)
  fireEvent.click(screen.getByTestId('open-upload'))
  fireEvent.click(screen.getByRole('button', { name: 'Close upload' }))
  rerender(<Album isUploading={false} stage="error" error="UPLOAD_FAILED" />)

  fireEvent.click(screen.getByRole('button', { name: 'Upload failed · Retry' }))
  const dialog = screen.getByRole('dialog', { name: 'Share your memories' })
  expect(within(dialog).getByRole('alert').textContent).toBe(
    'Your upload could not be completed. Please try again.',
  )
  fireEvent.click(within(dialog).getByTestId('start-upload'))
  expect(props.onUpload).toHaveBeenCalledOnce()
})

test('delivers new notifications inside the active upload dialog', () => {
  const { rerender } = render(<Album />)
  fireEvent.click(screen.getByTestId('open-upload'))
  rerender(<Album toasts={[{ id: 'uploaded', guestName: 'Alex', fileCount: 3 }]} />)
  const dialog = screen.getByRole('dialog', { name: 'Share your memories' })
  expect(within(dialog).getByText('Alex added 3 files')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close upload' }))
  expect(screen.getByText('Alex added 3 files').closest('dialog')).toBeNull()
})

test.each(['', '   '])('requires a real name before submitting (name %j)', (guestName) => {
  const onUpload = vi.fn()
  render(<Album guestName={guestName} onUpload={onUpload} isUploading={false} stage="idle" />)
  fireEvent.click(screen.getByTestId('open-upload'))
  const input = screen.getByRole('textbox', { name: 'Your name' }) as HTMLInputElement
  expect(input.placeholder).toBe('Guest')
  expect(input.value).toBe(guestName)
  fireEvent.click(screen.getByTestId('start-upload'))
  expect(onUpload).not.toHaveBeenCalled()
  expect(input.validity.valid).toBe(false)
})

test('closes only for a new successful upload and permits reopening without another dismissal', () => {
  const { rerender } = render(<Album />)
  fireEvent.click(screen.getByTestId('open-upload'))
  // A completed status from an older batch must not close the current form.
  rerender(<Album stage="complete" />)
  expect(screen.getByRole('dialog')).toBeTruthy()
  const success = { id: 'batch-1', count: 3 }
  rerender(<Album stage="complete" isUploading={false} uploadSuccess={success} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByTestId('upload-success').textContent).toContain('3 files successfully added')
  fireEvent.click(screen.getByTestId('open-upload'))
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
  expect(screen.queryByTestId('upload-success')).toBeNull()
  rerender(<Album stage="complete" isUploading={false} uploadSuccess={success} />)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.queryByTestId('upload-success')).toBeNull()
})

test('changes language in place and saves the preference while preserving an upload draft', () => {
  render(<Album guestName="Олена" />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nl' } })
  expect(document.documentElement.lang).toBe('nl')
  expect(document.cookie).toContain('NEXT_LOCALE=nl')
  fireEvent.click(screen.getByTestId('open-upload'))
  expect((screen.getByRole('textbox', { name: 'Je naam' }) as HTMLInputElement).value).toBe('Олена')
  expect(screen.getByRole('dialog', { name: 'Deel je herinneringen' })).toBeTruthy()
})
