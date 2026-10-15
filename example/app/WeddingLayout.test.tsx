// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const ownCards = (
  <div>
    <div className="card" data-assembly-id="older">
      <button type="button" className="gallery-open">
        Older photo
      </button>
    </div>
    <div className="card" data-assembly-id="batch-asm">
      <button type="button" className="gallery-open">
        New photo
      </button>
    </div>
  </div>
)

const scrolledCards = () =>
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts as Element[]

test('brings a finished upload into view for guests who watched it, without moving focus', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { rerender } = render(<Album assemblyId="batch-asm" />)
  // A real click focuses the opener, which the dialog restores on close.
  screen.getByTestId('open-upload').focus()
  fireEvent.click(screen.getByTestId('open-upload'))
  // The gallery renders the batch after the upload resolves, as live queries and polling do.
  rerender(
    <Album
      assemblyId="batch-asm"
      stage="complete"
      isUploading={false}
      uploadSuccess={{ id: 'batch-1', count: 2 }}
    />,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  rerender(
    <Album
      assemblyId="batch-asm"
      stage="complete"
      isUploading={false}
      uploadSuccess={{ id: 'batch-1', count: 2 }}
    >
      {ownCards}
    </Album>,
  )
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce())
  expect(scrolledCards()[0]?.getAttribute('data-assembly-id')).toBe('batch-asm')
  expect(document.activeElement).toBe(screen.getByTestId('open-upload'))
})

test('lets guests who kept browsing jump to their upload from the notification', () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { rerender } = render(<Album assemblyId="batch-asm">{ownCards}</Album>)
  fireEvent.click(screen.getByTestId('open-upload'))
  fireEvent.click(screen.getByRole('button', { name: 'Close upload' }))
  rerender(
    <Album
      assemblyId="batch-asm"
      stage="complete"
      isUploading={false}
      uploadSuccess={{ id: 'batch-1', count: 2 }}
    >
      {ownCards}
    </Album>,
  )
  // Browsing guests keep their place until they ask for the new items.
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  fireEvent.click(
    within(screen.getByTestId('upload-success')).getByRole('button', { name: 'Show in album' }),
  )
  expect(scrolledCards()[0]?.getAttribute('data-assembly-id')).toBe('batch-asm')
  expect(document.activeElement?.textContent).toBe('New photo')
})

test.each([
  [24, 'The album shows uploads for 24 hours.'],
  [Number.POSITIVE_INFINITY, null],
])('states the demo limits before guests choose files (retention %s)', (hours, visibility) => {
  render(<Album retentionMs={hours * 3_600_000} />)
  fireEvent.click(screen.getByTestId('open-upload'))
  const notice = screen.getByTestId('demo-notice').textContent ?? ''
  expect(notice).toContain('This is a demo, not a private archive.')
  expect(notice).toContain('Share only test photos and videos you can replace.')
  expect(notice).toContain('This legacy local test uses public media links.')
  // Hiding is a display limit; physical cleanup happens later, so the copy never promises erasure.
  if (visibility) {
    expect(notice).toContain(visibility)
    expect(notice).toContain('Hidden files are not erased right away.')
  } else {
    expect(notice).not.toContain('shows uploads for')
  }
  expect(notice).not.toMatch(/deleted|permanently/i)
})

test('explains private media delivery and the legacy-link limit in the hosted album', () => {
  render(<Album authState="authenticated" />)
  fireEvent.click(screen.getByTestId('open-upload'))
  const notice = screen.getByTestId('demo-notice').textContent ?? ''
  expect(notice).toContain('New photos, videos and originals use private Transloadit Storage.')
  expect(notice).toContain('Older public links are not made private retroactively.')
})

const finished = {
  stage: 'complete',
  isUploading: false,
  uploadSuccess: { id: 'batch-1', count: 2 },
} as const

test('queues a requested reveal until the new card renders, then focuses it', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { rerender } = render(<Album assemblyId="batch-asm" />)
  rerender(<Album assemblyId="batch-asm" {...finished} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show in album' }))
  rerender(
    <Album assemblyId="batch-asm" {...finished}>
      {ownCards}
    </Album>,
  )
  await waitFor(() => expect(document.activeElement?.textContent).toBe('New photo'))
  expect(scrolledCards()[scrolledCards().length - 1]?.getAttribute('data-assembly-id')).toBe(
    'batch-asm',
  )
})

test('closes a reopened uploader before revealing from its notification', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { rerender } = render(<Album assemblyId="batch-asm">{ownCards}</Album>)
  rerender(
    <Album assemblyId="batch-asm" {...finished}>
      {ownCards}
    </Album>,
  )
  fireEvent.click(screen.getByTestId('open-upload'))
  const dialog = screen.getByRole('dialog', { name: 'Share your memories' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Show in album' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(document.activeElement?.textContent).toBe('New photo'))
})

test('keeps the notification while its action has focus', () => {
  vi.useFakeTimers()
  try {
    const { rerender } = render(<Album assemblyId="batch-asm" />)
    rerender(<Album assemblyId="batch-asm" {...finished} />)
    const action = screen.getByRole('button', { name: 'Show in album' })
    fireEvent.focus(action)
    act(() => vi.advanceTimersByTime(9000))
    expect(screen.getByTestId('upload-success')).toBeTruthy()
    fireEvent.blur(action)
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.queryByTestId('upload-success')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('drops a pending automatic reveal when the guest reopens the uploader', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { rerender } = render(<Album assemblyId="batch-asm" />)
  fireEvent.click(screen.getByTestId('open-upload'))
  rerender(<Album assemblyId="batch-asm" {...finished} />)
  fireEvent.click(screen.getByTestId('open-upload'))
  rerender(
    <Album assemblyId="batch-asm" {...finished}>
      {ownCards}
    </Album>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Close upload' }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
})

test('lets later notifications expire after a focused one was dismissed', () => {
  vi.useFakeTimers()
  try {
    const { rerender } = render(<Album assemblyId="batch-asm" />)
    rerender(<Album assemblyId="batch-asm" {...finished} />)
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    fireEvent.focus(dismiss)
    // Removing a focused element does not reliably fire blur.
    fireEvent.click(dismiss)
    rerender(
      <Album assemblyId="batch-asm" {...finished} uploadSuccess={{ id: 'batch-2', count: 1 }} />,
    )
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.queryByTestId('upload-success')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('shows the album at once when the requested items have not rendered yet', () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { rerender } = render(<Album assemblyId="batch-asm" />)
  rerender(<Album assemblyId="batch-asm" {...finished} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show in album' }))
  expect(scrolledCards()[0]?.id).toBe('memories')
})
