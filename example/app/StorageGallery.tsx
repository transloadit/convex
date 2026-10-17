'use client'

import { useQuery } from 'convex/react'
import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server'
import { usePaginatedQuery } from 'convex-helpers/react'
import { Component, type ReactNode, useState } from 'react'
import { galleryRetentionMs, type StorageGalleryAsset } from '../lib/gallery'
import { parseGalleryMedia, useGalleryLocation } from '../lib/gallery-location'
import { Gallery } from './Gallery'

const listMediaRef = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions; createdAfter?: number },
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
  // Paging and rendering share one visit's clock: loading another page must not move its cutoff.
  const [displayTime] = useState(Date.now)
  const createdAfter = Number.isFinite(galleryRetentionMs)
    ? displayTime - galleryRetentionMs
    : undefined
  const media = usePaginatedQuery(listMediaRef, { createdAfter }, { initialNumItems: pageSize })
  const selected = useGalleryLocation()
  const identity = parseGalleryMedia(selected)
  const listed = media.results.some(
    ({ asset }) => `${asset.asset_id}.${asset.version_id}` === selected,
  )
  const linked = useQuery(getMediaRef, identity && !listed ? identity : 'skip')
  return (
    <Gallery
      displayTime={displayTime}
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
