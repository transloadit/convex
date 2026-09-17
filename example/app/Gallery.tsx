'use client'

import { spring } from 'motion'
import { AnimateView } from 'motion/react-animate-view'
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
import { buildGalleryItems, type GalleryItem } from '../lib/gallery'
import type { AssemblyResultResponse } from '../lib/transloadit'

const motionPreference = '(prefers-reduced-motion: reduce)'
const subscribeToMotionPreference = (onChange: () => void) => {
  const query = window.matchMedia(motionPreference)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const readMotionPreference = () => window.matchMedia(motionPreference).matches
const slideTransition = { type: spring, visualDuration: 0.3, bounce: 0.2 }
const isNavigation = (types: string[]) => types.includes('next') || types.includes('previous')
// React can batch both types. Both layers must agree on one direction and move oppositely.
const slideOffset = (types: string[]) => (types.includes('next') ? 100 : -100)

const Media = ({
  item,
  viewing = false,
  onDimensions,
}: {
  item: GalleryItem
  viewing?: boolean
  onDimensions?: (width: number, height: number) => void
}) =>
  item.kind === 'video' ? (
    // biome-ignore lint/a11y/useMediaCaption: Guest clips do not have caption tracks.
    <video
      src={item.url}
      poster={item.posterUrl}
      controls={viewing}
      playsInline
      preload={viewing ? 'metadata' : 'none'}
      aria-label={item.name}
      onLoadedMetadata={(event) =>
        onDimensions?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
      }
    />
  ) : (
    <img
      src={item.url}
      alt={item.name}
      loading={viewing ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={(event) =>
        onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
      }
    />
  )

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
        aria-label={`View ${item.name}`}
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
            <span aria-hidden="true">▶</span> Video
          </span>
        )}
      </button>
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
        <p id={titleId}>{item.name}</p>
        <button type="button" onClick={onClose} aria-label="Close viewer">
          Close <span aria-hidden="true">×</span>
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
          Previous
        </button>
        <span aria-live="polite">
          {position + 1} / {total}
        </span>
        <button type="button" onClick={onNext} disabled={position === total - 1}>
          Next
        </button>
      </div>
    </dialog>
  )
}

export const Gallery = ({ results }: { results: AssemblyResultResponse[] }) => {
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
        <h3>The first memory is yours.</h3>
        <p>Use Share photos to add your favourite photos and videos from the day.</p>
      </div>
    )
  }

  return (
    <>
      <p className="gallery-count">
        {items.length} {items.length === 1 ? 'memory' : 'memories'} & counting
      </p>
      <div className="gallery" data-testid="gallery">
        {items.map((item) => (
          // Thumbnails only share names when the viewer opens/closes, so navigation stays a slide.
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
