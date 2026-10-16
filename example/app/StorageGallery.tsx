'use client'

import { useQuery } from 'convex/react'
import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server'
import { usePaginatedQuery } from 'convex-helpers/react'
import { Component, type ReactNode } from 'react'
import type { StorageGalleryAsset } from '../lib/gallery'
import { parseGalleryMedia, useGalleryLocation } from '../lib/gallery-location'
import { Gallery } from './Gallery'

const listMediaRef = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<StorageGalleryAsset>
>('media:list')
const getMediaRef = makeFunctionReference<
  'query',
  { assetId: string; versionId: string },
  StorageGalleryAsset | null
>('media:get')
const pageSize = 24

// Canonical private receipts only; the media route authorizes every request.
const StoragePages = () => {
  const media = usePaginatedQuery(listMediaRef, {}, { initialNumItems: pageSize })
  const selected = useGalleryLocation()
  const identity = parseGalleryMedia(selected)
  const listed = media.results.some(
    ({ asset }) => `${asset.asset_id}.${asset.version_id}` === selected,
  )
  const linked = useQuery(getMediaRef, identity && !listed ? identity : 'skip')
  return (
    <Gallery
      linkedAsset={linked}
      linkLoading={Boolean(identity && !listed && linked === undefined)}
      storageAssets={media.results}
      loading={media.status === 'LoadingFirstPage'}
      loadingMore={media.status === 'LoadingMore'}
      onLoadMore={media.status === 'CanLoadMore' ? () => media.loadMore(pageSize) : undefined}
    />
  )
}

// usePaginatedQuery restarts on refused cursors and throws other failures while rendering: show
// those instead of stale photos until the album mounts again.
class LoadFailure extends Component<{ children: ReactNode }> {
  state = { failed: false }
  static getDerivedStateFromError = () => ({ failed: true })
  render() {
    if (!this.state.failed) return this.props.children
    return <Gallery loadFailed />
  }
}

export const StorageGallery = () => (
  <LoadFailure>
    <StoragePages />
  </LoadFailure>
)
