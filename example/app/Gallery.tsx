'use client'

import { getStorageAssetHref, Image } from '@transloadit/viewer/react'
import { ImagePrefetch, ImagePreview } from '@transloadit/viewer/react/preview'
import { Video } from '@transloadit/viewer/react/video'
import { useTranslations } from 'next-intl'
import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  buildStorageGalleryItems,
  type GalleryItem,
  type StorageGalleryAsset,
  thumbnailSizes,
} from '../lib/gallery'
import { selectGalleryMedia, useGalleryLocation } from '../lib/gallery-location'
import { ShareMemory } from './ShareMemory'

const viewerDelivery = { sizes: '100vw' }

function Media({
  item,
  viewing = false,
  onLoad,
}: {
  item: GalleryItem
  viewing?: boolean
  onLoad?: () => void
}) {
  const t = useTranslations('viewer')
  if (item.receipt)
    return viewing ? (
      <ImagePreview
        src={item.receipt}
        alt={item.name || t('moment')}
        {...viewerDelivery}
        loadingFallback={
          <span role="status" className="viewer-loading">
            {t('loading')}
          </span>
        }
        errorFallback={
          <p role="alert" className="viewer-error">
            {t('loadFailed')}
          </p>
        }
        onReady={onLoad}
      />
    ) : (
      <Image
        src={item.receipt}
        alt={item.name || t('moment')}
        sizes={thumbnailSizes(item.aspectRatio)}
        loading="lazy"
        placeholder="blur"
        objectFit="cover"
      />
    )
  if (!item.video) return <p>{t('videoUnavailable')}</p>
  return (
    <Video
      src={item.video}
      poster={item.poster}
      controls={viewing}
      playsInline
      preload={viewing ? 'metadata' : 'none'}
      aria-label={item.name || t('moment')}
    />
  )
}

function GalleryCard({ item, onSelect }: { item: GalleryItem; onSelect: () => void }) {
  const t = useTranslations('viewer')
  return (
    <div
      className="card"
      data-assembly-id={item.assemblyId}
      style={{ '--media-ratio': item.aspectRatio ?? 3 / 2 } as CSSProperties}
    >
      <button
        type="button"
        className="gallery-open"
        onClick={onSelect}
        aria-label={t('view', { name: item.name || t('moment') })}
      >
        <div className="gallery-media">
          <Media item={item} />
        </div>
        {item.kind === 'video' ? (
          <span className="badge">
            <span aria-hidden="true">▶</span> {t('video')}
          </span>
        ) : null}
      </button>
      <p className="gallery-credit">
        {item.uploadedBy ? t('addedBy', { name: item.uploadedBy }) : t('unknownContributor')}
      </p>
    </div>
  )
}

function GallerySlide({
  item,
  neighbor,
  direction,
}: {
  item: GalleryItem
  neighbor?: GalleryItem
  direction: 'next' | 'previous'
}) {
  // This keyed visit owns readiness. Returning to a photo must not reuse an older load event.
  const [ready, setReady] = useState(false)
  return (
    <>
      <div className={`viewer-slide viewer-slide-${direction}`}>
        <Media item={item} viewing onLoad={() => setReady(true)} />
      </div>
      {ready && neighbor?.receipt ? (
        <ImagePrefetch key={neighbor.id} src={neighbor.receipt} {...viewerDelivery} />
      ) : null}
    </>
  )
}

function GalleryViewer({
  item,
  neighbor,
  position,
  total,
  pending,
  direction,
  onPrevious,
  onNext,
}: {
  item?: GalleryItem
  neighbor?: GalleryItem
  position: number
  total: number
  pending: boolean
  direction: 'next' | 'previous'
  onPrevious: () => void
  onNext: () => void
}) {
  const t = useTranslations('viewer')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    const overflow = document.body.style.overflow
    dialog?.showModal()
    closeRef.current?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    if (position > 0 && position < total - 1) return
    // Disabling the focused boundary button can move browser focus outside the modal.
    // Keep subsequent arrow/Escape keys in the viewer without replacing native disabled buttons.
    const focused = document.activeElement
    if (
      focused === document.body ||
      (focused instanceof HTMLButtonElement &&
        focused.disabled &&
        dialogRef.current?.contains(focused))
    ) {
      const neighbor = position === 0 ? nextRef.current : previousRef.current
      const target = neighbor && !neighbor.disabled ? neighbor : closeRef.current
      target?.focus({ preventScroll: true })
    }
  }, [position, total])
  const close = () => selectGalleryMedia(null)
  return (
    <dialog
      ref={dialogRef}
      className="gallery-viewer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => {
        // Native media controls and text selection own their arrow keys.
        if (event.target instanceof HTMLVideoElement || event.target instanceof HTMLInputElement)
          return
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onPrevious()
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onNext()
        }
      }}
    >
      <div className="viewer-toolbar">
        <div className="viewer-caption">
          <p id={titleId}>{item?.name || t('moment')}</p>
          {item ? (
            <span className="viewer-credit">
              {item.uploadedBy ? t('addedBy', { name: item.uploadedBy }) : t('unknownContributor')}
            </span>
          ) : null}
        </div>
        <div className="viewer-actions">
          {item ? <ShareMemory id={item.id} name={item.name || t('moment')} /> : null}
          {item?.original ? (
            <a
              className="viewer-download"
              href={getStorageAssetHref(item.original, { action: 'download' })}
            >
              {t('download')}
            </a>
          ) : null}
          <button ref={closeRef} type="button" onClick={close} aria-label={t('close')}>
            ×
          </button>
        </div>
      </div>
      <div className="viewer-stage">
        {item ? (
          <GallerySlide
            key={JSON.stringify([item.id, item.original?.workspace, viewerDelivery])}
            item={item}
            neighbor={neighbor}
            direction={direction}
          />
        ) : (
          <p role={pending ? 'status' : 'alert'}>{pending ? t('loading') : t('unavailable')}</p>
        )}
      </div>
      <div className="viewer-toolbar viewer-navigation">
        <button ref={previousRef} type="button" onClick={onPrevious} disabled={position <= 0}>
          {t('previous')}
        </button>
        <span aria-live="polite">
          {item && position >= 0 ? t('position', { current: position + 1, total }) : ''}
        </span>
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          disabled={position < 0 || position >= total - 1}
        >
          {t('next')}
        </button>
      </div>
    </dialog>
  )
}

export function Gallery({
  storageAssets = [],
  linkedAsset,
  linkLoading = false,
  onLoadMore,
  loadFailed = false,
  loading = false,
  loadingMore = false,
}: {
  storageAssets?: StorageGalleryAsset[]
  linkedAsset?: StorageGalleryAsset | null
  linkLoading?: boolean
  onLoadMore?: () => void
  loadFailed?: boolean
  loading?: boolean
  loadingMore?: boolean
}) {
  const t = useTranslations('album')
  const selectedId = useGalleryLocation()
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const items = loadFailed ? [] : buildStorageGalleryItems(storageAssets)
  const position = items.findIndex((item) => item.id === selectedId)
  // A deep-linked item outside loaded pages has no known neighbors or ordinal. Keep its live
  // authorized subscription, but do not append it to the grid or invent a pagination position.
  const linked = linkedAsset && !loadFailed ? buildStorageGalleryItems([linkedAsset]) : []
  const selected = items[position] ?? linked.find((item) => item.id === selectedId)
  const navigate = (value: 'next' | 'previous') => {
    // Read the current URL, not a render closure, so rapid clicks never collapse into one move.
    const id = new URLSearchParams(window.location.search).get('media')
    const current = items.findIndex((item) => item.id === id)
    const next = current < 0 ? undefined : items[current + (value === 'next' ? 1 : -1)]
    if (!next) return
    setDirection(value)
    selectGalleryMedia(next.id)
  }
  return (
    <>
      {loadFailed ? (
        <p className="gallery-error" role="alert">
          {t('loadFailed')}
        </p>
      ) : null}
      {loading ? (
        <p className="gallery-loading" role="status">
          {t('loading')}
        </p>
      ) : null}
      {items.length ? (
        <>
          <p className="gallery-count">{t('count', { count: items.length })}</p>
          <div className="gallery" data-testid="gallery">
            {items.map((item) => (
              <GalleryCard
                key={item.id}
                item={item}
                onSelect={() => {
                  setDirection('next')
                  selectGalleryMedia(item.id)
                }}
              />
            ))}
          </div>
        </>
      ) : !loadFailed && !loading && !onLoadMore && !selectedId ? (
        <div className="gallery-empty" data-testid="gallery-empty">
          <span className="empty-flower" aria-hidden="true">
            ✳
          </span>
          <h3>{t('emptyTitle')}</h3>
          <p>{t('emptyHint')}</p>
        </div>
      ) : null}
      {onLoadMore || loadingMore ? (
        <button
          type="button"
          className="button gallery-more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? t('loading') : t('loadMore')}
        </button>
      ) : null}
      {selectedId !== null ? (
        <GalleryViewer
          item={selected}
          neighbor={position >= 0 ? items[position + (direction === 'next' ? 1 : -1)] : undefined}
          position={position}
          total={items.length}
          pending={linkLoading}
          direction={direction}
          onPrevious={() => navigate('previous')}
          onNext={() => navigate('next')}
        />
      ) : null}
    </>
  )
}
