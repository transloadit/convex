// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
// JSDOM does not decode pixels; the browser suite covers real and deliberately delayed decoding.
HTMLImageElement.prototype.decode = () => Promise.resolve()

beforeEach(() => {
  window.history.replaceState(null, '', '/')

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
  vi.restoreAllMocks()
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

test('copies only the exact-version album link, and updates it on navigation', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  window.history.replaceState(null, '', '/?tracking=discard#old')
  const first = photo(1)
  const second = photo(2)
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[first, second]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  await waitFor(() => expect(screen.getByText('Link copied').getAttribute('role')).toBe('status'))
  expect(writeText).toHaveBeenLastCalledWith(
    `${window.location.origin}/?media=${first.asset.asset_id}.${first.asset.version_id}`,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.queryByText('Link copied')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/?media=${second.asset.asset_id}.${second.asset.version_id}`,
    ),
  )
})

test('native sharing is preferred; cancellation does not copy or report an error', async () => {
  const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
  const writeText = vi.fn()
  vi.stubGlobal('navigator', { share, clipboard: { writeText } })
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  await waitFor(() => expect(share).toHaveBeenCalledOnce())
  expect(writeText).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('keeps Share focused when arrow navigation changes an interior photo', () => {
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1), photo(2), photo(3), photo(4)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-2.jpg' }))
  const share = screen.getByRole('button', { name: 'Share' })
  share.focus()
  fireEvent.keyDown(share, { key: 'ArrowRight' })
  expect(screen.getByRole('dialog', { name: 'photo-3.jpg' })).toBeTruthy()
  expect(document.activeElement).toBe(share)
  fireEvent.keyDown(share, { key: 'ArrowLeft' })
  expect(screen.getByRole('dialog', { name: 'photo-2.jpg' })).toBeTruthy()
})

test('does not show a late clipboard result for a different visit to the photo', async () => {
  let resolve!: () => void
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    },
  })
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1), photo(2)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  await act(async () => resolve())
  expect(screen.queryByText('Link copied')).toBeNull()
  expect(screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled')).toBe(false)
})

test('allows arrow-key selection of a manual link without changing the photo', async () => {
  vi.stubGlobal('navigator', {})
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1), photo(2), photo(3)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-2.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  const link = await screen.findByRole('textbox', { name: 'Link to this memory' })
  link.focus()
  fireEvent.keyDown(link, { key: 'ArrowLeft', shiftKey: true })
  fireEvent.keyDown(link, { key: 'ArrowRight' })
  expect(screen.getByRole('dialog', { name: 'photo-2.jpg' })).toBeTruthy()
  expect(document.activeElement).toBe(link)
})

test('a refused clipboard write leaves a selectable link and a useful message', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
  })
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  await waitFor(() =>
    expect(
      screen
        .getByText('Copy this link to share this memory. Album access is still required.')
        .getAttribute('role'),
    ).toBe('status'),
  )
  expect(
    screen.getByRole('textbox', { name: 'Link to this memory' }).getAttribute('value'),
  ).toContain('?media=')
})

test.each([true, false])(
  'downloads the private video original, with playback available=%s',
  (playable) => {
    const original = photo(1, 1920, 1080, { mime: 'video/quicktime', path: 'upload/clip.mov' })
    const video = { ...photo(2).asset, mime: 'video/mp4', path: 'upload/play.mp4' }
    render(
      <AlbumIntlProvider initialLocale="en">
        <Gallery storageAssets={[{ ...original, video: playable ? video : undefined }]} />
      </AlbumIntlProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View clip.mov' }))
    const href = screen.getByRole('link', { name: 'Download original' }).getAttribute('href')
    const params = new URL(href ?? '', 'https://example.test').searchParams
    expect(params.get('asset_id')).toBe(original.asset.asset_id)
    expect(params.get('action')).toBe('download')
    if (playable) {
      const player = within(screen.getByRole('dialog')).getByLabelText('clip.mov')
      expect(player.getAttribute('src')).toContain(video.asset_id)
      expect(player.hasAttribute('controls')).toBe(true)
    } else {
      expect(screen.getByRole('dialog').textContent).toContain(
        'Video preview unavailable. You can still download the original.',
      )
    }
  },
)

// The parts of a real player's state that a network failure and a reload change.
const openPlayer = () => {
  const original = photo(1, 1920, 1080, { mime: 'video/quicktime', path: 'upload/clip.mov' })
  const video = { ...photo(2).asset, mime: 'video/mp4', path: 'upload/play.mp4' }
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[{ ...original, video }]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View clip.mov' }))
  const player = within(screen.getByRole('dialog')).getByLabelText('clip.mov')
  if (!(player instanceof HTMLVideoElement)) throw new Error('expected a native video player')
  const media = { currentTime: 0, paused: true, error: null as { code: number } | null }
  for (const name of ['currentTime', 'paused', 'error'] as const)
    Object.defineProperty(player, name, {
      get: () => media[name],
      set: (value) => Object.assign(media, { [name]: value }),
    })
  const load = vi.spyOn(player, 'load').mockImplementation(() => {
    Object.assign(media, { currentTime: 0, paused: true, error: null })
  })
  const play = vi.spyOn(player, 'play').mockImplementation(async () => {
    media.paused = false
  })
  vi.spyOn(player, 'pause').mockImplementation(() => {
    media.paused = true
  })
  // Chromium reports a refused byte range (expired grant) as a network error, then pauses.
  const fail = (code = 2) => {
    Object.assign(media, { error: { code }, paused: true })
    fireEvent(player, new Event('error'))
    fireEvent(player, new Event('pause'))
  }
  return { player, media, load, play, fail, src: player.getAttribute('src') }
}

test.each([true, false])(
  'an expired video grant renews through the same route, keeping position and playing=%s',
  (playing) => {
    const { player, media, load, play, fail, src } = openPlayer()
    fireEvent(player, new Event('loadedmetadata'))
    if (playing) {
      media.paused = false
      fireEvent(player, new Event('play'))
    }
    media.currentTime = 93.5
    fail()
    expect(load).toHaveBeenCalledTimes(1)
    // The stable route URL reauthorizes the guest; no CDN URL is ever put on the element.
    expect(player.getAttribute('src')).toBe(src)
    fireEvent(player, new Event('loadedmetadata'))
    expect(media.currentTime).toBe(93.5)
    fireEvent(player, new Event('seeked'))
    expect(play).toHaveBeenCalledTimes(playing ? 1 : 0)
    expect(media.paused).toBe(!playing)
    // A renewed grant that delivered media can itself be renewed when it expires later.
    media.currentTime = 400
    fail()
    expect(load).toHaveBeenCalledTimes(2)
  },
)

test('a denied video reauthorization stays denied, without further retries', () => {
  const { player, media, load, play, fail } = openPlayer()
  fireEvent(player, new Event('loadedmetadata'))
  media.paused = false
  fireEvent(player, new Event('play'))
  media.currentTime = 42
  fail()
  expect(load).toHaveBeenCalledTimes(1)
  // The route refuses the expired or revoked guest: the reload fails before any metadata loads.
  fail(4)
  fail()
  expect(load).toHaveBeenCalledTimes(1)
  // Nothing from the refused renewal lingers to move or start a later source.
  media.currentTime = 0
  fireEvent(player, new Event('loadedmetadata'))
  fireEvent(player, new Event('seeked'))
  expect(media.currentTime).toBe(0)
  expect(play).not.toHaveBeenCalled()
})

test('a video that never loaded, or failed to decode, is not reloaded', () => {
  const { player, load, fail } = openPlayer()
  fail()
  expect(load).not.toHaveBeenCalled()
  fireEvent(player, new Event('loadedmetadata'))
  fail(3)
  expect(load).not.toHaveBeenCalled()
})

const pictureImage = (root: ParentNode) => {
  const image = root.querySelector('picture img')
  if (!(image instanceof HTMLImageElement)) throw new Error('expected a picture image')
  return image
}

const placeholder = (image: HTMLImageElement) => ({
  blur: image.style.backgroundImage.startsWith('url("data:image/png;base64,'),
  objectFit: image.style.objectFit,
})

const thumbnails = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="gallery"] .card picture')].map((picture) => ({
    sizes: [...picture.querySelectorAll('source')].map((source) => source.getAttribute('sizes')),
    srcsets: [...picture.querySelectorAll('source')].map((source) => source.getAttribute('srcset')),
  }))

test('opening and closing the viewer preserves thumbnail nodes and candidates', async () => {
  const assets = [photo(1), photo(2, 800, 1200), photo(3, 1600, 900)]
  const { container } = render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={assets} />
    </AlbumIntlProvider>,
  )
  const before = thumbnails(container)
  const nodes = [...container.querySelectorAll('.gallery picture img')]
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
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(thumbnails(container)).toEqual(before)
  expect([...container.querySelectorAll('.gallery picture img')]).toEqual(nodes)
})

test('a page emptied by filtering still offers the next page instead of the empty album', () => {
  const onLoadMore = vi.fn()
  // No listable photos on this page (binding or geometry filtered every row), but more may follow.
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1, 0, 0)]} onLoadMore={onLoadMore} />
    </AlbumIntlProvider>,
  )
  expect(screen.queryByTestId('gallery-empty')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show more memories' }))
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('an album without photos or later pages shows the empty state', () => {
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[]} />
    </AlbumIntlProvider>,
  )
  expect(screen.getByTestId('gallery-empty')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Show more memories' })).toBeNull()
})

test('a private photo opens on Close rather than the new original-download link', async () => {
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1)]} />
    </AlbumIntlProvider>,
  )
  const opener = screen.getByRole('button', { name: /View photo-1/ })
  opener.focus()
  fireEvent.click(opener)
  expect(screen.getByRole('link', { name: 'Download original' })).not.toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close viewer' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel'))
  await waitFor(() => expect(document.activeElement).toBe(opener))
})

test('opaque thumbnails paint their ThumbHash behind the final pixels without changing on load', () => {
  const { container } = render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery
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
})

test('navigation updates the shared URL and caption before the next photo loads', async () => {
  const first = photo(1, 1200, 800, { thumbhash: opaqueHash })
  const second = photo(2, 1200, 800, { thumbhash: opaqueHash })
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[first, second]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  expect(new URLSearchParams(location.search).get('media')).toBe(
    `${first.asset.asset_id}.${first.asset.version_id}`,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  const dialog = screen.getByRole('dialog', { name: 'photo-2.jpg' })
  expect(new URLSearchParams(location.search).get('media')).toBe(
    `${second.asset.asset_id}.${second.asset.version_id}`,
  )
  expect(within(dialog).getByRole('status').textContent).toBe('Loading photo…')
  expect(dialog.querySelector('img[aria-hidden]')).not.toBeNull()
  fireEvent.load(pictureImage(dialog))
  await waitFor(() => expect(within(dialog).queryByRole('status')).toBeNull())
  expect(dialog.querySelector('img[aria-hidden]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(new URLSearchParams(location.search).get('media')).toBeNull()
})

test('preloads the previous neighbor after navigating backwards and loading the current photo', async () => {
  const assets = [photo(1), photo(2), photo(3)]
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={assets} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-3.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  const dialog = screen.getByRole('dialog', { name: 'photo-2.jpg' })
  // Speculative images are deliberately hidden, so their network attributes are the contract.
  expect(dialog.querySelector('img[fetchpriority="low"]')).toBeNull()
  fireEvent.load(within(dialog).getByRole('img', { name: 'photo-2.jpg' }))
  await waitFor(() => {
    expect(dialog.querySelector('img[fetchpriority="low"]')?.getAttribute('src')).toContain(
      assets[0].asset.asset_id,
    )
  })
  expect(dialog.querySelectorAll('img[fetchpriority="low"]')).toHaveLength(1)
})

test('warms only the next photo after the current video has a frame, not just metadata', async () => {
  const original = photo(1, 1920, 1080, { mime: 'video/quicktime', path: 'upload/clip.mov' })
  const video = { ...photo(10).asset, mime: 'video/mp4', path: 'upload/play.mp4' }
  const next = photo(2)
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[{ ...original, video }, next, photo(3)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View clip.mov' }))
  const dialog = screen.getByRole('dialog', { name: 'clip.mov' })
  const player = within(dialog).getByLabelText('clip.mov')
  expect(dialog.querySelector('img[fetchpriority="low"]')).toBeNull()
  fireEvent.loadedMetadata(player)
  expect(dialog.querySelector('img[fetchpriority="low"]')).toBeNull()
  fireEvent.loadedData(player)
  await waitFor(() => {
    expect(dialog.querySelector('img[fetchpriority="low"]')?.getAttribute('src')).toContain(
      next.asset.asset_id,
    )
  })
  expect(dialog.querySelectorAll('img[fetchpriority="low"]')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('dialog', { name: 'photo-2.jpg' })).toBeTruthy()
  expect(new URLSearchParams(location.search).get('media')).toBe(
    `${next.asset.asset_id}.${next.asset.version_id}`,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.getByRole('dialog').querySelector('img[fetchpriority="low"]')).toBeNull()
})

test('a loaded video never speculatively loads the next video', () => {
  const first = photo(1, 1920, 1080, { mime: 'video/quicktime', path: 'upload/first.mov' })
  const second = photo(2, 1920, 1080, { mime: 'video/quicktime', path: 'upload/second.mov' })
  const video = { ...photo(10).asset, mime: 'video/mp4', path: 'upload/play.mp4' }
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery
        storageAssets={[
          { ...first, video },
          { ...second, video },
        ]}
      />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View first.mov' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.loadedData(within(dialog).getByLabelText('first.mov'))
  expect(dialog.querySelector('img[fetchpriority="low"]')).toBeNull()
  expect(dialog.querySelectorAll('video')).toHaveLength(1)
})

test('returning to a photo waits for its current render instead of reusing old ready state', async () => {
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[photo(1), photo(2), photo(3)]} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-2.jpg' }))
  const second = screen.getByRole('dialog', { name: 'photo-2.jpg' })
  fireEvent.load(within(second).getByRole('img', { name: 'photo-2.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('Loading photo…')
  expect(screen.getByRole('dialog').querySelector('img[fetchpriority="low"]')).toBeNull()
  fireEvent.load(within(screen.getByRole('dialog')).getByRole('img', { name: 'photo-2.jpg' }))
  await waitFor(() =>
    expect(screen.getByRole('dialog').querySelectorAll('img[fetchpriority="low"]')).toHaveLength(1),
  )
})

test('opening a thumbnail starts prefetching forwards after a previous backward visit', async () => {
  const assets = [photo(1), photo(2), photo(3)]
  render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={assets} />
    </AlbumIntlProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'View photo-3.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  const dialog = screen.getByRole('dialog', { name: 'photo-1.jpg' })
  fireEvent.load(within(dialog).getByRole('img', { name: 'photo-1.jpg' }))
  await waitFor(() => {
    expect(dialog.querySelector('img[fetchpriority="low"]')?.getAttribute('src')).toContain(
      assets[1].asset.asset_id,
    )
  })
})

test('a changed delivery workspace invalidates readiness even for the same asset and version', async () => {
  const first = photo(1)
  const second = photo(2)
  const view = (asset: StorageGalleryAsset) => (
    <AlbumIntlProvider initialLocale="en">
      <Gallery storageAssets={[asset, second]} />
    </AlbumIntlProvider>
  )
  const { rerender } = render(view(first))
  fireEvent.click(screen.getByRole('button', { name: 'View photo-1.jpg' }))
  fireEvent.load(within(screen.getByRole('dialog')).getByRole('img', { name: 'photo-1.jpg' }))
  await waitFor(() =>
    expect(screen.getByRole('dialog').querySelectorAll('img[fetchpriority="low"]')).toHaveLength(1),
  )
  rerender(view({ ...first, asset: { ...first.asset, workspace: 'other-workspace' } }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('status').textContent).toBe('Loading photo…')
  expect(dialog.querySelector('img[fetchpriority="low"]')).toBeNull()
})

test('opens a shared link outside the loaded page, and fails closed after access loss', () => {
  const asset = photo(99)
  const id = `${asset.asset.asset_id}.${asset.asset.version_id}`
  window.history.replaceState(null, '', `/?media=${id}&keep=1`)
  const { rerender } = render(
    <AlbumIntlProvider initialLocale="en">
      <Gallery linkLoading />
    </AlbumIntlProvider>,
  )
  expect(within(screen.getByRole('dialog')).getByRole('status')).not.toBeNull()
  rerender(
    <AlbumIntlProvider initialLocale="en">
      <Gallery linkedAsset={asset} />
    </AlbumIntlProvider>,
  )
  expect(screen.getByRole('dialog', { name: 'photo-99.jpg' })).not.toBeNull()
  rerender(
    <AlbumIntlProvider initialLocale="en">
      <Gallery loadFailed />
    </AlbumIntlProvider>,
  )
  expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/unavailable/)
  expect(screen.queryByRole('link', { name: 'Download original' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
  expect(location.search).toBe('?keep=1')
})
