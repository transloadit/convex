import { createRoot } from 'react-dom/client'
import { Gallery } from '../../../example/app/Gallery'
import { AlbumIntlProvider } from '../../../example/i18n/AlbumIntlProvider'
import type { StorageGalleryAsset } from '../../../example/lib/gallery'

const photo = (index: number): StorageGalleryAsset => ({
  id: `photo-${index}`,
  assemblyId: `assembly-${index}`,
  uploadedBy: 'Alex',
  createdAt: Date.now(),
  asset: {
    workspace: 'wedding',
    asset_id: `${index}`.padEnd(21, 'x') + 'A',
    version_id: 'v'.repeat(21) + 'A',
    path: `photo-${index}.jpg`,
    size: 1234,
    mime: 'image/jpeg',
    width: 1600,
    height: 1067,
    thumbhash: 'IvkFHYx/iHiHh3h3d3h4d494+IiI',
  },
})
const video = (index: number): StorageGalleryAsset => {
  const original = photo(index)
  const playback = photo(index * 10).asset
  return {
    ...original,
    asset: { ...original.asset, path: `video-${index}.mp4`, mime: 'video/mp4' },
    video: { ...playback, path: `video-${index}.mp4`, mime: 'video/mp4' },
  }
}
const assets = new URLSearchParams(window.location.search).has('mixed')
  ? [photo(1), video(2), photo(3), video(4)]
  : [photo(1), photo(2), photo(3)]
const linkedAsset = photo(99)
if (new URLSearchParams(window.location.search).has('longName')) {
  linkedAsset.asset.path =
    'a-very-long-wedding-photo-name-that-must-not-push-controls-offscreen.jpg'
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing gallery fixture root')
createRoot(root).render(
  <AlbumIntlProvider initialLocale="en">
    <main className="album-section">
      <h1>Wedding memories</h1>
      <Gallery storageAssets={assets} linkedAsset={linkedAsset} />
    </main>
  </AlbumIntlProvider>,
)
