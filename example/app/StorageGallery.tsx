'use client'

import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server'
import { usePaginatedQuery } from 'convex-helpers/react'
import { Component, type ReactNode, useEffect } from 'react'
import type { GalleryResult, StorageGalleryAsset } from '../lib/gallery'
import { Gallery } from './Gallery'

const listMediaRef = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<StorageGalleryAsset>
>('media:list')
const pageSize = 24

// Canonical private receipts only; the media route authorizes every request.
const StoragePages = ({ results }: { results: GalleryResult[] }) => {
  const media = usePaginatedQuery(listMediaRef, {}, { initialNumItems: pageSize })
  // A receipt page can contain only renditions. Advance that live query instead of showing an
  // empty album with a misleading manual "Show more" button. Never overlap page requests.
  // Rows the Gallery itself drops (photos without geometry), and rendition-only pages after the
  // first cards, keep that explicit button; the grouped-media query in #45 pages originals only
  // and removes this skipping altogether.
  useEffect(() => {
    if (media.results.length === 0 && media.status === 'CanLoadMore') media.loadMore(pageSize)
  }, [media.results.length, media.status, media.loadMore])
  return (
    <Gallery
      results={results}
      storageAssets={media.results}
      onLoadMore={media.status === 'CanLoadMore' ? () => media.loadMore(pageSize) : undefined}
    />
  )
}

// usePaginatedQuery restarts on refused cursors and throws other failures while rendering: show
// those instead of stale photos until the album mounts again.
class LoadFailure extends Component<{ children: ReactNode; results: GalleryResult[] }> {
  state = { failed: false }
  static getDerivedStateFromError = () => ({ failed: true })
  render() {
    if (!this.state.failed) return this.props.children
    return <Gallery results={this.props.results} loadFailed />
  }
}

export const StorageGallery = ({ results }: { results: GalleryResult[] }) => (
  <LoadFailure results={results}>
    <StoragePages results={results} />
  </LoadFailure>
)
