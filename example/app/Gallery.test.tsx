// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { StoredAsset } from '@transloadit/convex'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
import type { StorageGalleryAsset } from '../lib/gallery'
import { Gallery } from './Gallery'

// JSDOM does not implement the browser's modal/top-layer behavior.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true
}
HTMLDialogElement.prototype.close = function () {
  this.open = false
}

beforeEach(() => {
  // Full motion, so thumbnails use the animated boundaries that opening the viewer toggles.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const photo = (
  index: number,
  width = 1200,
  height = 800,
  metadata: Partial<StoredAsset> = {},
): StorageGalleryAsset => ({
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
    width,
    height,
    ...metadata,
  },
})

// ThumbHashes of a small opaque image and of one with transparent pixels (encoded alpha bit set).
const opaqueHash = 'IvkFHYx/iHiHh3h3d3h4d494+IiI'
const alphaHash = '4eiFE4gbb2iHh3dvePiGiHGAiIiHiIg='

const pictureImage = (root: ParentNode) => {
  const image = root.querySelector('picture img')
  if (!(image instanceof HTMLImageElement)) throw new Error('expected a picture image')
  return image
}

const placeholder = (image: HTMLImageElement) => ({
  blur: image.style.backgroundImage.startsWith('url("data:image/png;base64,'),
  objectFit: image.style.objectFit,
})

// React's view transitions wait for images that have no onLoad handler.
const handlers = (image: HTMLImageElement) => {
  const key = Object.keys(image).find((name) => name.startsWith('__reactProps$'))
  const props = (key ? (image as unknown as Record<string, object>)[key] : {}) ?? {}
  return Object.keys(props).filter((name) => /^on[A-Z]/.test(name))
}

const thumbnails = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="gallery"] .card picture')].map((picture) => ({
    sizes: [...picture.querySelectorAll('source')].map((source) => source.getAttribute('sizes')),
    srcsets: [...picture.querySelectorAll('source')].map((source) => source.getAttribute('srcset')),
  }))

test('opening and closing the viewer keeps every thumbnail on the same candidates', () => {
  const assets = [photo(1), photo(2, 800, 1200), photo(3, 1600, 900)]
  const { container } = render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery results={[]} storageAssets={assets} />
    </AlbumIntlProvider>,
  )
  const before = thumbnails(container)
  expect(before).toHaveLength(3)
  for (const { sizes } of before) {
    // Explicit layout sizes: `auto` resolves differently for remounted images.
    expect(sizes.every((value) => value && !value.includes('auto'))).toBe(true)
  }
  const [firstCard] = screen.getAllByRole('button', { name: /View photo-1/ })
  if (!firstCard) throw new Error('expected a thumbnail button')
  fireEvent.click(firstCard)
  expect(container.querySelector('.gallery-viewer')).not.toBeNull()
  expect(thumbnails(container)).toEqual(before)
  fireEvent.keyDown(container.querySelector('.gallery-viewer') as Element, { key: 'Escape' })
  fireEvent(container.querySelector('.gallery-viewer') as Element, new Event('cancel'))
  expect(thumbnails(container)).toEqual(before)
})

test('a page emptied by filtering still offers the next page instead of the empty album', () => {
  const onLoadMore = vi.fn()
  // No listable photos on this page (binding or geometry filtered every row), but more may follow.
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery results={[]} storageAssets={[photo(1, 0, 0)]} onLoadMore={onLoadMore} />
    </AlbumIntlProvider>,
  )
  expect(screen.queryByTestId('gallery-empty')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show more memories' }))
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('an album without photos or later pages shows the empty state', () => {
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery results={[]} storageAssets={[]} />
    </AlbumIntlProvider>,
  )
  expect(screen.getByTestId('gallery-empty')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Show more memories' })).toBeNull()
})

test('opaque thumbnails paint their ThumbHash behind the final pixels, without load handlers', () => {
  const { container } = render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery
        results={[]}
        storageAssets={[
          photo(1, 1200, 800, { thumbhash: opaqueHash, has_alpha: false }),
          photo(2, 1200, 800, { thumbhash: alphaHash, has_alpha: true }),
          // Receipts that lost has_alpha still carry the alpha bit inside the hash.
          photo(3, 1200, 800, { thumbhash: alphaHash }),
          photo(4),
        ]}
      />
    </AlbumIntlProvider>,
  )
  const cards = [...container.querySelectorAll('[data-testid="gallery"] .card')]
  const images = cards.map(pictureImage)
  // Box-filling thumbnails say so explicitly, so the stylesheet's `contain` cannot hide a letterbox.
  expect(images.map(placeholder)).toEqual([
    { blur: true, objectFit: 'cover' },
    { blur: false, objectFit: 'cover' },
    { blur: false, objectFit: 'cover' },
    { blur: false, objectFit: 'cover' },
  ])
  // Loading and loaded markup are identical: the final opaque pixels simply cover the background.
  const [opaque] = images
  if (!opaque) throw new Error('expected the opaque thumbnail')
  const loading = opaque.outerHTML
  fireEvent.load(opaque)
  expect(opaque.outerHTML).toBe(loading)
  expect(images.flatMap(handlers)).toEqual([])
})

test('the letterboxed viewer never shows a placeholder, across transitions', () => {
  const assets = [
    photo(1, 1200, 800, { thumbhash: opaqueHash, has_alpha: false }),
    photo(2, 800, 1200, { thumbhash: opaqueHash, has_alpha: false }),
  ]
  const { container } = render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery results={[]} storageAssets={assets} />
    </AlbumIntlProvider>,
  )
  const cards = () => [...container.querySelectorAll('[data-testid="gallery"] .card')]
  const before = cards().map((card) => placeholder(pictureImage(card)))
  const [firstCard] = screen.getAllByRole('button', { name: /View photo-1/ })
  if (!firstCard) throw new Error('expected a thumbnail button')
  fireEvent.click(firstCard)
  const viewer = container.querySelector('.gallery-viewer')
  if (!viewer) throw new Error('expected the viewer')
  const viewed = () => pictureImage(viewer.querySelector('.viewer-media') as Element)
  expect(placeholder(viewed())).toEqual({ blur: false, objectFit: 'contain' })
  expect(handlers(viewed())).toEqual([])
  fireEvent.keyDown(viewer, { key: 'ArrowRight' })
  expect(viewer.querySelector('p')?.textContent).toBe('photo-2.jpg')
  expect(placeholder(viewed())).toEqual({ blur: false, objectFit: 'contain' })
  expect(handlers(viewed())).toEqual([])
  fireEvent(viewer, new Event('cancel'))
  expect(cards().map((card) => placeholder(pictureImage(card)))).toEqual(before)
})
