'use client'

import { spring } from 'motion'
import { AnimateView } from 'motion/react-animate-view'
import { useTranslations } from 'next-intl'
import {
  addTransitionType,
  type CSSProperties,
  startTransition,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { buildGalleryItems, type GalleryItem, type GalleryResult } from '../lib/gallery'

const motionPreference = '(prefers-reduced-motion: reduce)'
const subscribeToMotionPreference = (onChange: () => void) => {
  const query = window.matchMedia(motionPreference)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const readMotionPreference = () => window.matchMedia(motionPreference).matches
const slideTransition = { type: spring, visualDuration: 0.3, bounce: 0.2 }
const isNavigation = (types: string[]) => types.includes('next') || types.includes('previous')
// React can batch opposite directions. Prefer next for that ambiguous combination, even if the
// net movement is backward; both snapshot layers must use the same rule to move oppositely.
const slideOffset = (types: string[]) => (types.includes('next') ? 100 : -100)

const Media = ({
  item,
  viewing = false,
  onDimensions,
}: {
  item: GalleryItem
  viewing?: boolean
  onDimensions?: (width: number, height: number) => void
}) => {
  const t = useTranslations('viewer')
  return item.kind === 'video' ? (
    // biome-ignore lint/a11y/useMediaCaption: Guest clips do not have caption tracks.
    <video
      src={item.url}
      poster={item.posterUrl}
      controls={viewing}
      playsInline
      preload={viewing ? 'metadata' : 'none'}
      aria-label={item.name || t('moment')}
      onLoadedMetadata={(event) =>
        onDimensions?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
      }
    />
  ) : (
    <img
      src={item.url}
      alt={item.name || t('moment')}
      loading={viewing ? 'eager' : 'lazy'}
      decoding="async"
      // An onLoad handler opts out of React's image-loading wait during view transitions.
      onLoad={
        onDimensions
          ? (event) =>
              onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          : undefined
      }
    />
  )
}

const GalleryCard = ({
  item,
  name,
  animate,
  onSelect,
}: {
  item: GalleryItem
  name: string
  animate: boolean
  onSelect: () => void
}) => {
  const t = useTranslations('viewer')
  const [ratio, setRatio] = useState(item.aspectRatio ?? 3 / 2)
  const media = (
    <div className="gallery-media">
      <Media
        item={item}
        onDimensions={(width, height) => {
          if (width > 0 && height > 0) setRatio(width / height)
        }}
      />
    </div>
  )
  return (
    <div
      className="card"
      data-assembly-id={item.assemblyId}
      style={{ '--media-ratio': ratio } as CSSProperties}
    >
      <button
        type="button"
        className="gallery-open"
        onClick={onSelect}
        aria-label={t('view', { name: item.name || t('moment') })}
      >
        {animate ? (
          <AnimateView
            name={name}
            transition={{ type: spring, duration: 0.45, bounce: 0.12 }}
            enter={{ opacity: 1, transition: { type: false, duration: 0 } }}
            exit={{ opacity: 0, transition: { type: false, duration: 0 } }}
          >
            {media}
          </AnimateView>
        ) : (
          media
        )}
        {item.kind === 'video' && (
          <span className="badge">
            <span aria-hidden="true">▶</span> {t('video')}
          </span>
        )}
      </button>
      <p className="gallery-credit">
        {item.uploadedBy ? t('addedBy', { name: item.uploadedBy }) : t('unknownContributor')}
      </p>
    </div>
  )
}

const GalleryViewer = ({
  item,
  position,
  total,
  name,
  onClose,
  onPrevious,
  onNext,
  reducedMotion,
}: {
  item: GalleryItem
  position: number
  total: number
  name: string
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  reducedMotion: boolean
}) => {
  const t = useTranslations('viewer')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    const overflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true })
    }
  }, [])

  const media = <Media key={item.id} item={item} viewing />

  return (
    <dialog
      ref={dialogRef}
      className="gallery-viewer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        // Preserve the video player's native arrow-key seeking.
        if ((event.target as HTMLElement).tagName === 'VIDEO') return
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
          <p id={titleId}>{item.name || t('moment')}</p>
          <span className="viewer-credit">
            {item.uploadedBy ? t('addedBy', { name: item.uploadedBy }) : t('unknownContributor')}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label={t('close')}>
          {t('closeButton')} <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="viewer-media">
        {reducedMotion ? (
          media
        ) : (
          <AnimateView
            key={item.id}
            name={name}
            transition={{ type: spring, duration: 0.45, bounce: 0.12 }}
            enter={(types) =>
              isNavigation(types)
                ? {
                    opacity: 1,
                    transform: [`translateX(${slideOffset(types)}%)`, 'translateX(0%)'],
                    transition: slideTransition,
                  }
                : {}
            }
            exit={(types) =>
              isNavigation(types)
                ? {
                    opacity: 0,
                    transform: `translateX(${-slideOffset(types)}%)`,
                    transition: slideTransition,
                  }
                : {}
            }
          >
            {media}
          </AnimateView>
        )}
      </div>
      <div className="viewer-toolbar viewer-navigation">
        <button type="button" onClick={onPrevious} disabled={position === 0}>
          {t('previous')}
        </button>
        <span aria-live="polite">{t('position', { current: position + 1, total })}</span>
        <button type="button" onClick={onNext} disabled={position === total - 1}>
          {t('next')}
        </button>
      </div>
    </dialog>
  )
}

export const Gallery = ({ results }: { results: GalleryResult[] }) => {
  const t = useTranslations('album')
  const items = buildGalleryItems(results)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Subscribe to changes too: Motion's hook currently snapshots this preference at mount.
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    readMotionPreference,
    () => true,
  )
  const instanceId = useId()
  const position = items.findIndex((item) => item.id === selectedId)
  const selected = items[position]
  const select = (id: string | null) => startTransition(() => setSelectedId(id))
  const navigate = (direction: 'next' | 'previous') => {
    startTransition(() => {
      addTransitionType(direction)
      setSelectedId((currentId) => {
        const currentPosition = items.findIndex((item) => item.id === currentId)
        if (currentPosition === -1) return currentId
        return items[currentPosition + (direction === 'next' ? 1 : -1)]?.id ?? currentId
      })
    })
  }
  // Encode every character so arbitrary filenames cannot collide or become invalid CSS names.
  const transitionName = (id: string) =>
    `photo-${Array.from(`${instanceId}-${id}`, (char) => char.codePointAt(0)?.toString(16)).join('-')}`

  if (!items.length) {
    return (
      <div className="gallery-empty" data-testid="gallery-empty">
        <span className="empty-flower" aria-hidden="true">
          ✳
        </span>
        <h3>{t('emptyTitle')}</h3>
        <p>{t('emptyHint')}</p>
      </div>
    )
  }

  return (
    <>
      <p className="gallery-count">{t('count', { count: items.length })}</p>
      <div className="gallery" data-testid="gallery">
        {items.map((item) => (
          // Named thumbnail boundaries leave the tree to share with the viewer, then stay absent
          // during navigation so it stays a slide. This simple demo remounts thumbnail media;
          // an archive-scale gallery should virtualize that handoff to avoid remounting every tile.
          <GalleryCard
            key={item.id}
            item={item}
            name={transitionName(item.id)}
            animate={!selected && !reducedMotion}
            onSelect={() => select(item.id)}
          />
        ))}
      </div>
      {selected && (
        <GalleryViewer
          item={selected}
          name={transitionName(selected.id)}
          position={position}
          total={items.length}
          reducedMotion={reducedMotion}
          onClose={() => select(null)}
          onPrevious={() => navigate('previous')}
          onNext={() => navigate('next')}
        />
      )}
    </>
  )
}
