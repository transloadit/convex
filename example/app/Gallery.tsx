'use client'

import { spring } from 'motion'
import { AnimateView } from 'motion/react-animate-view'
import {
  addTransitionType,
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

const Media = ({ item, viewing = false }: { item: GalleryItem; viewing?: boolean }) =>
  item.kind === 'video' ? (
    // biome-ignore lint/a11y/useMediaCaption: Guest clips do not have caption tracks.
    <video
      src={item.url}
      poster={item.posterUrl}
      controls={viewing}
      playsInline
      preload={viewing ? 'metadata' : 'none'}
      aria-label={item.name}
    />
  ) : (
    <img src={item.url} alt={item.name} loading={viewing ? 'eager' : 'lazy'} decoding="async" />
  )

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
      <p className="status" data-testid="gallery-empty">
        Uploads will appear here once processing completes.
      </p>
    )
  }

  return (
    <>
      <div className="gallery" data-testid="gallery">
        {items.map((item) => {
          const media = (
            <div className="gallery-media">
              <Media item={item} />
            </div>
          )
          return (
            <div className="card" data-assembly-id={item.assemblyId} key={item.id}>
              <button
                type="button"
                className="gallery-open"
                onClick={() => select(item.id)}
                aria-label={`View ${item.name}`}
              >
                {/* While viewing, thumbnails must not share names with the slides: otherwise
                    Next/Previous morph to and from the grid instead of sliding across the viewer. */}
                {selected || reducedMotion ? (
                  media
                ) : (
                  <AnimateView
                    name={transitionName(item.id)}
                    transition={{ type: spring, duration: 0.45, bounce: 0.12 }}
                    enter={{ opacity: 1, transition: { type: false, duration: 0 } }}
                    exit={{ opacity: 0, transition: { type: false, duration: 0 } }}
                  >
                    {media}
                  </AnimateView>
                )}
                <span className="badge">{item.kind === 'video' ? 'Video' : 'Photo'}</span>
              </button>
              <div className="meta">{item.name}</div>
            </div>
          )
        })}
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
