'use client'

import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server'
import { usePaginatedQuery } from 'convex-helpers/react'
import { Component, type ReactNode } from 'react'
import type { GalleryResult, StorageGalleryAsset } from '../lib/gallery'
import { Gallery } from './Gallery'

const listMediaRef = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<StorageGalleryAsset>
>('media:list')
const pageSize = 24

// Private photos: canonical receipts only; the media route authorizes every image request.
const StoragePages = ({ results }: { results: GalleryResult[] }) => {
  const media = usePaginatedQuery(listMediaRef, {}, { initialNumItems: pageSize })
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
