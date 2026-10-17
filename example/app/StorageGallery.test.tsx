// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import type { PaginationOptions } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
import { galleryRetentionMs, type StorageGalleryAsset } from '../lib/gallery'
import { StorageGallery } from './StorageGallery'

// A client whose subscriptions answer from `respond`; `update` pushes a new answer to all of them.
let respond: (options: PaginationOptions) => unknown = () => undefined
let respondLinked: (args: { assetId?: string; versionId?: string }) => unknown = () => null
const listeners = new Set<() => void>()
const warn = vi.fn()
const client = {
  logger: { warn },
  watchQuery: (
    _query: unknown,
    args: { paginationOpts?: PaginationOptions; assetId?: string; versionId?: string },
  ) => ({
    onUpdate: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    localQueryResult: () => {
      const result = args.paginationOpts ? respond(args.paginationOpts) : respondLinked(args)
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
  window.history.replaceState(null, '', '/')
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  respondLinked = () => null
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
      <StorageGallery />
    </AlbumIntlProvider>
  </ConvexProvider>
)
const shown = () => screen.queryAllByRole('button', { name: /View photo-/ }).length

test('announces loading instead of claiming an unanswered album is empty', () => {
  respond = () => undefined
  render(album)
  expect(screen.getByRole('status').textContent).toBe('Loading memories…')
  expect(screen.queryByText('The first memory is yours.')).toBeNull()
  update(() => ({ page: [], isDone: true, continueCursor: 'end' }))
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('The first memory is yours.')).toBeTruthy()
})

test('keeps the next-page button disabled and announces loading while a page is pending', () => {
  respond = ({ cursor }) =>
    cursor === null ? { page: [photo(1)], isDone: false, continueCursor: 'next' } : undefined
  render(album)
  fireEvent.click(screen.getByRole('button', { name: 'Show more memories' }))
  expect(screen.getByRole('button', { name: 'Loading memories…' }).hasAttribute('disabled')).toBe(
    true,
  )
  expect(shown()).toBe(1)
})

test('keeps one display cutoff for query pages and rendered memories throughout the visit', () => {
  const openedAt = Date.now()
  const now = vi.spyOn(Date, 'now').mockReturnValue(openedAt)
  const watch = vi.spyOn(client, 'watchQuery')
  const first = { ...photo(1), createdAt: openedAt - galleryRetentionMs + 2000 }
  const second = { ...photo(2), createdAt: openedAt - galleryRetentionMs + 1000 }
  respond = ({ cursor }) =>
    cursor === null
      ? { page: [first], isDone: false, continueCursor: 'next' }
      : { page: [second], isDone: true, continueCursor: 'end' }
  render(album)
  expect(shown()).toBe(1)
  expect(watch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ createdAfter: openedAt - galleryRetentionMs }),
    expect.anything(),
  )

  now.mockReturnValue(openedAt + 5000)
  fireEvent.click(screen.getByRole('button', { name: 'Show more memories' }))
  expect(shown()).toBe(2)
  expect(screen.queryByRole('button', { name: 'Show more memories' })).toBeNull()
  expect(
    watch.mock.calls.every(([, args]) => args?.createdAfter === openedAt - galleryRetentionMs),
  ).toBe(true)
})

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

test('keeps manual pagination when app authorization filters a whole media page', () => {
  respond = ({ cursor }) =>
    cursor === null
      ? { page: [], isDone: false, continueCursor: 'next' }
      : { page: [photo(1)], isDone: true, continueCursor: 'end' }
  render(album)
  expect(shown()).toBe(0)
  expect(listeners.size).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Show more memories' }))
  expect(shown()).toBe(1)
  expect(screen.queryByRole('button', { name: 'Show more memories' })).toBeNull()
})

test('an exhausted empty album does not request more pages', () => {
  respond = () => ({ page: [], isDone: true, continueCursor: 'end' })
  render(album)
  expect(screen.queryByRole('button', { name: 'Show more memories' })).toBeNull()
  expect(listeners.size).toBe(1)
})

test('resolves a shared item outside the first page without fetching every page, and removes revoked data', () => {
  const linked = photo(99)
  const selected = `${linked.asset.asset_id}.${linked.asset.version_id}`
  window.history.replaceState(null, '', `/?media=${selected}`)
  const list = vi.fn((_options: PaginationOptions) => ({
    page: [photo(1)],
    isDone: false,
    continueCursor: 'next',
  }))
  const get = vi.fn(() => linked)
  respond = list
  respondLinked = get
  render(album)
  expect(screen.getByRole('dialog', { name: 'photo-99.jpg' })).not.toBeNull()
  expect(shown()).toBe(1)
  expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByText('2 / 2')).toBeNull()
  expect(get).toHaveBeenCalledWith({
    assetId: linked.asset.asset_id,
    versionId: linked.asset.version_id,
  })
  expect(list.mock.calls.every(([args]) => args.cursor === null)).toBe(true)
  respondLinked = () => null
  update(list)
  expect(screen.getByRole('dialog').textContent).toContain('This memory is unavailable')
  expect(screen.queryByRole('link', { name: 'Download original' })).toBeNull()
})

test('a malformed link never reaches the exact-asset query', () => {
  window.history.replaceState(null, '', '/?media=invalid')
  respond = () => ({ page: [], isDone: true, continueCursor: 'end' })
  const get = vi.fn()
  respondLinked = get
  render(album)
  expect(screen.getByRole('alert').textContent).toContain('This memory is unavailable')
  expect(get).not.toHaveBeenCalled()
})
