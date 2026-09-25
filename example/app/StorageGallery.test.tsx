// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import type { PaginationOptions } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
import type { StorageGalleryAsset } from '../lib/gallery'
import { StorageGallery } from './StorageGallery'

// A client whose subscriptions answer from `respond`; `update` pushes a new answer to all of them.
let respond: (options: PaginationOptions) => unknown = () => undefined
const listeners = new Set<() => void>()
const warn = vi.fn()
const client = {
  logger: { warn },
  watchQuery: (_query: unknown, args: { paginationOpts: PaginationOptions }) => ({
    onUpdate: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    localQueryResult: () => {
      const result = respond(args.paginationOpts)
      if (result instanceof Error) throw result
      return result
    },
    journal: () => undefined,
  }),
} as unknown as ConvexReactClient
const update = (next: typeof respond) => {
  respond = next
  act(() => {
    for (const listener of listeners) listener()
  })
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  warn.mockReset()
  listeners.clear()
})

const photo = (index: number): StorageGalleryAsset => ({
  id: `photo-${index}`,
  assemblyId: `assembly-${index}`,
  uploadedBy: 'Alex',
  createdAt: Date.now() - index,
  asset: {
    workspace: 'open-test-prod',
    asset_id: `asset${index}`.padEnd(21, 'x').concat('A'),
    version_id: `version${index}`.padEnd(21, 'x').concat('A'),
    path: `convex-demo/local/wedding-gallery/upload/photo-${index}.jpg`,
    size: 1,
    mime: 'image/jpeg',
    width: 1200,
    height: 800,
  },
})

const album = (
  <ConvexProvider client={client}>
    <AlbumIntlProvider initialLocale="en">
      <StorageGallery results={[]} />
    </AlbumIntlProvider>
  </ConvexProvider>
)
const shown = () => screen.queryAllByRole('button', { name: /View photo-/ }).length

test('refused cursors restart the album, other failures replace its photos with an alert', () => {
  respond = ({ cursor }) =>
    cursor === null
      ? { page: [photo(1)], isDone: false, continueCursor: 'next' }
      : new ConvexError('InvalidCursor: restart Storage pagination')
  render(album)
  expect(shown()).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Show more memories' }))
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('InvalidCursor'))
  expect(shown()).toBe(1)
  expect(screen.queryByRole('alert')).toBeNull()

  // React reports the caught render error too.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  update(() => new Error('ACCESS_REQUIRED'))
  expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/)
  expect(shown()).toBe(0)
  expect(screen.queryByRole('button', { name: 'Show more memories' })).toBeNull()
})
