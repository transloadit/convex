'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import {
  Component,
  type FocusEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { galleryRetentionMs } from '../lib/gallery'
import { maxGuestNameLength } from '../lib/guest-name'
import type { UploadErrorCode } from '../lib/upload-errors'
import { wedding } from '../lib/wedding'
import { LanguageSwitcher } from './LanguageSwitcher'
import { stageRank, type UploadStage, type WeddingUppy } from './useWeddingUppy'

const Dashboard = dynamic(() => import('./WeddingDashboard'), {
  ssr: false,
  loading: UploaderLoading,
})

function UploaderLoading() {
  const t = useTranslations('upload')
  return <p role="status">{t('gettingReady')}</p>
}

// A failed lazy Dashboard chunk must not take down the album or leave a submit button behind.
class UploaderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export type Toast = { id: string; guestName?: string; fileCount?: number }
export type UploadSuccess = { id: string; count: number }

// Live queries and polling can render a batch shortly after its upload resolves.
const revealWaitMs = 15_000

// Scrolls to a batch's first gallery card. Focus moves only when the guest asked for it.
const revealUpload = (collection: HTMLElement, assemblyId: string, focus: boolean) => {
  const card = Array.from(collection.querySelectorAll<HTMLElement>('[data-assembly-id]')).find(
    (element) => element.dataset.assemblyId === assemblyId,
  )
  if (!card) return false
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  if (focus) card.querySelector<HTMLElement>('.gallery-open')?.focus({ preventScroll: true })
  return true
}

const Plus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const UploadDialog = ({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) => {
  const t = useTranslations('upload')
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const overflow = document.body.style.overflow
    ref.current?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      ref.current?.close()
      document.body.style.overflow = overflow
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true })
    }
  }, [open])

  // Keep Dashboard mounted when closed so selected files and ongoing uploads are preserved.
  return (
    <dialog
      ref={ref}
      className="upload-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="upload-dialog-heading">
        <div>
          <p className="eyebrow">{t('eyebrow')}</p>
          <h2 id={titleId}>{t('title')}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </div>
      <p className="upload-intro">{t('intro')}</p>
      {children}
    </dialog>
  )
}

const UploadTimeline = ({ stage }: { stage: UploadStage }) => {
  const t = useTranslations('upload.stages')
  if (stage === 'idle' || stage === 'complete') return null
  const steps = ['creating', 'uploading', 'processing', 'complete'] as const
  return (
    <div className="timeline" data-testid="upload-timeline" aria-live="polite">
      {steps.map((step) => (
        <div
          key={step}
          className={`timeline-step${stage !== 'error' && stageRank[stage] >= stageRank[step] ? ' active' : ''}${stage === step ? ' current' : ''}`}
        >
          <span className="timeline-dot" />
          {t(step)}
        </div>
      ))}
      {stage === 'error' && <div className="timeline-error">{t('error')}</div>}
    </div>
  )
}

export const WeddingLayout = ({
  uppy,
  onUploadRequest,
  uploaderFailed = false,
  guestName,
  onGuestNameChange,
  onLeave,
  isUploading,
  onUpload,
  error,
  assemblyId,
  assemblyParams,
  status,
  stage,
  uploadSuccess,
  toasts,
  authState,
  retentionMs = galleryRetentionMs,
  children,
}: {
  uppy: WeddingUppy | null
  onUploadRequest: () => void
  uploaderFailed?: boolean
  guestName: string
  onGuestNameChange: (value: string) => void
  onLeave: () => void
  isUploading: boolean
  onUpload: () => void
  error: UploadErrorCode | null
  assemblyId: string | null
  assemblyParams: Record<string, unknown> | null
  status: string
  stage: UploadStage
  uploadSuccess?: UploadSuccess | null
  toasts?: Toast[]
  authState?: 'loading' | 'authenticated' | 'guest'
  retentionMs?: number
  children: ReactNode
}) => {
  const t = useTranslations()
  const formId = useId()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [visibleSuccess, setVisibleSuccess] = useState<
    (UploadSuccess & { assemblyId: string | null }) | null
  >(null)
  const [pendingReveal, setPendingReveal] = useState<{ assemblyId: string; focus: boolean } | null>(
    null,
  )
  const [successFocused, setSuccessFocused] = useState(false)
  const collectionRef = useRef<HTMLElement>(null)
  // Read at completion time; declared first so they are current when the success effect runs.
  const uploadOpenRef = useRef(uploadOpen)
  const assemblyIdRef = useRef(assemblyId)
  useEffect(() => {
    uploadOpenRef.current = uploadOpen
    assemblyIdRef.current = assemblyId
  })
  useEffect(() => {
    if (!uploadSuccess) return
    const batch = assemblyIdRef.current
    // Guests who watched the upload see the result; guests who kept browsing keep their place.
    if (uploadOpenRef.current && batch) setPendingReveal({ assemblyId: batch, focus: false })
    setUploadOpen(false)
    setVisibleSuccess({ ...uploadSuccess, assemblyId: batch })
    setSuccessFocused(false)
  }, [uploadSuccess])
  useEffect(() => {
    if (!visibleSuccess || successFocused) return
    const timer = setTimeout(() => setVisibleSuccess(null), 8000)
    return () => clearTimeout(timer)
  }, [visibleSuccess, successFocused])
  // A new batch in the uploader supersedes any reveal still waiting for the previous one.
  useEffect(() => {
    if (uploadOpen) setPendingReveal(null)
  }, [uploadOpen])
  useEffect(() => {
    const collection = collectionRef.current
    // Runs after the dialog closed and restored focus, so a requested focus is not undone.
    if (!pendingReveal || !collection || uploadOpen) return
    const { assemblyId: batch, focus } = pendingReveal
    if (revealUpload(collection, batch, focus)) {
      setPendingReveal(null)
      return
    }
    // An explicit request shows the album at once, then moves to the items when they render.
    if (focus) collection.scrollIntoView({ block: 'start' })
    const observer = new MutationObserver(() => {
      if (revealUpload(collection, batch, focus)) setPendingReveal(null)
    })
    observer.observe(collection, { childList: true, subtree: true })
    const timer = setTimeout(() => setPendingReveal(null), revealWaitMs)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [pendingReveal, uploadOpen])
  // Keyboard and screen reader users keep the notification and its action while focused on it.
  const holdSuccess = {
    onFocus: () => setSuccessFocused(true),
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
        setSuccessFocused(false)
      }
    },
  }
  const payloadText = assemblyParams ? JSON.stringify(assemblyParams, null, 2) : null
  const notifications = Boolean(visibleSuccess || toasts?.length) && (
    <div className={`toast-stack${uploadOpen ? ' toast-inline' : ''}`} role="status">
      {visibleSuccess && (
        <div className="toast toast-success" data-testid="upload-success">
          <span className="toast-check" aria-hidden="true">
            ✓
          </span>
          <span className="toast-text">{t('upload.success', { count: visibleSuccess.count })}</span>
          {visibleSuccess.assemblyId && (
            <button
              type="button"
              className="toast-action"
              {...holdSuccess}
              onClick={() => {
                if (!visibleSuccess.assemblyId) return
                // From inside a reopened uploader, close it first; the reveal waits for the card.
                // Moving the notification out of the dialog unmounts these buttons without a blur.
                setSuccessFocused(false)
                setUploadOpen(false)
                setPendingReveal({ assemblyId: visibleSuccess.assemblyId, focus: true })
              }}
            >
              {t('upload.showNew')}
            </button>
          )}
          <button
            type="button"
            className="toast-dismiss"
            {...holdSuccess}
            onClick={() => {
              // Removing a focused button does not reliably fire blur.
              setSuccessFocused(false)
              setVisibleSuccess(null)
            }}
            aria-label={t('upload.dismiss')}
          >
            ×
          </button>
        </div>
      )}
      {toasts?.map((toast) => (
        <div className="toast" key={toast.id}>
          {toast.fileCount === undefined
            ? t('notifications.uploadedUnknown', {
                name: toast.guestName ?? t('notifications.guest'),
              })
            : t('notifications.uploaded', {
                name: toast.guestName ?? t('notifications.guest'),
                count: toast.fileCount,
              })}
        </div>
      ))}
    </div>
  )
  const handleCopy = async () => {
    if (!payloadText || !navigator.clipboard) return
    await navigator.clipboard.writeText(payloadText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="page" data-auth-state={authState ?? 'authenticated'} suppressHydrationWarning>
      <a className="skip-link" href="#memories">
        {t('album.skip')}
      </a>
      <header className="album-header">
        <a
          className="album-brand"
          href="#welcome"
          aria-label={t('album.backToTop', { names: wedding.names })}
        >
          <span className="monogram">{wedding.initials}</span>
          <span className="brand-caption">{t('album.brand')}</span>
        </a>
        <div className="header-actions">
          <LanguageSwitcher />
          <button
            type="button"
            className="leave-album"
            onClick={onLeave}
            disabled={isUploading}
            aria-label={t('access.leave')}
            title={t('access.leave')}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M10 4H4v16h6M13 7l5 5-5 5M8 12h12" />
            </svg>
          </button>
          <button
            className={`button share-button${stage === 'error' ? ' upload-failed' : ''}`}
            type="button"
            onClick={() => {
              onUploadRequest()
              setUploadOpen(true)
            }}
            data-testid="open-upload"
            aria-live="polite"
          >
            <Plus />
            {stage === 'error'
              ? t('upload.retry')
              : isUploading
                ? t('upload.uploading')
                : stage === 'processing'
                  ? t('upload.preparing')
                  : t('upload.share')}
          </button>
        </div>
      </header>

      <section className="album-cover" id="welcome" aria-labelledby="wedding-title">
        <img
          className="cover-image"
          src={wedding.cover}
          alt=""
          width="1200"
          height="896"
          fetchPriority="high"
        />
        <div className="cover-shade" />
        <div className="cover-content">
          <p className="eyebrow">{t('album.weddingOf')}</p>
          <h1 id="wedding-title">{wedding.names}</h1>
          {wedding.date && <p className="wedding-date">{wedding.date}</p>}
          <p className="cover-message">{t('album.tagline')}</p>
          <a className="explore-link" href="#memories">
            {t('album.explore')} <span aria-hidden="true">↓</span>
          </a>
        </div>
        <span className="cover-note" aria-hidden="true">
          {t('album.coverNote')}
        </span>
      </section>

      <section
        ref={collectionRef}
        className="album-collection"
        id="memories"
        aria-labelledby="collection-title"
      >
        <div className="collection-heading">
          <div>
            <p className="eyebrow">{t('album.collection')}</p>
            <h2 id="collection-title">{t('album.moments')}</h2>
          </div>
          <p>
            {t('album.collectionIntro')}
            <br />
            {t('album.perspectives')}
          </p>
        </div>
        {children}
      </section>

      <footer className="album-footer">
        <span className="footer-signature">{t('album.signature', { names: wedding.names })}</span>
        <p>
          {Number.isFinite(retentionMs)
            ? t('album.demoRetention', { hours: retentionMs / 3600000 })
            : t('album.demoAll')}
          <br />
          {t.rich('album.credits', {
            transloadit: (chunks) => <a href="https://transloadit.com/">{chunks}</a>,
            convex: (chunks) => <a href="https://github.com/transloadit/convex">{chunks}</a>,
          })}
        </p>
      </footer>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)}>
        <div className="demo-notice" data-testid="demo-notice">
          <p>
            <strong>{t('upload.demo.archive')}</strong> {t('upload.demo.media')}
          </p>
          <p>
            {Number.isFinite(retentionMs) &&
              `${t('upload.demo.visibility', { hours: retentionMs / 3600000 })} `}
            {t('upload.demo.privateDelivery')}
          </p>
        </div>
        {authState && authState !== 'authenticated' && (
          <p className="status" data-testid="auth-status">
            {t('upload.gettingReady')}
          </p>
        )}
        <form
          id={formId}
          className="upload-fields"
          onSubmit={(event) => {
            event.preventDefault()
            onUpload()
          }}
        >
          <label className="input">
            <span>{t('upload.name')}</span>
            <input
              value={guestName}
              disabled={isUploading}
              onChange={(event) => {
                event.target.setCustomValidity('')
                onGuestNameChange(event.target.value)
              }}
              onInvalid={(event) =>
                event.currentTarget.setCustomValidity(t('errors.NAME_REQUIRED'))
              }
              placeholder={t('upload.guestPlaceholder')}
              name="guestName"
              autoComplete="name"
              required
              pattern=".*\S.*"
              maxLength={maxGuestNameLength}
            />
          </label>
        </form>
        <UploaderBoundary fallback={<p role="alert">{t('upload.loadFailed')}</p>}>
          <div data-testid="uppy-dashboard">
            {uploaderFailed ? (
              <p role="alert">{t('upload.loadFailed')}</p>
            ) : uppy ? (
              <Dashboard uppy={uppy} disabled={isUploading} />
            ) : (
              <UploaderLoading />
            )}
          </div>
          <div className="cta">
            <button
              className="button"
              type="submit"
              form={formId}
              disabled={
                uploaderFailed ||
                !uppy ||
                isUploading ||
                (authState && authState !== 'authenticated')
              }
              data-testid="start-upload"
            >
              {isUploading ? t('upload.uploading') : t('upload.add')}
            </button>
            {(isUploading || stage === 'processing') && (
              <p className="upload-hint">{t('upload.keepBrowsing')}</p>
            )}
          </div>
        </UploaderBoundary>
        <UploadTimeline stage={stage} />
        {error && (
          <p className="status upload-error" data-testid="upload-error" role="alert">
            {t(`errors.${error}`)}
          </p>
        )}
        {(assemblyId || payloadText) && (
          <details className="developer-details">
            <summary>{t('debug.title')}</summary>
            {assemblyId && (
              <div className="status">
                <p data-testid="assembly-id">{t('debug.id', { id: assemblyId })}</p>
                <p data-testid="assembly-status">{t('debug.status', { status })}</p>
              </div>
            )}
            {payloadText && (
              <div className="payload-panel" data-testid="assembly-payload">
                <div className="payload-header">
                  <span>{t('debug.params')}</span>
                  <button className="ghost-button" type="button" onClick={() => void handleCopy()}>
                    {copied ? t('debug.copied') : t('debug.copy')}
                  </button>
                </div>
                <pre className="payload-code">{payloadText}</pre>
                <p className="payload-note">{t('debug.redacted')}</p>
              </div>
            )}
          </details>
        )}
        {uploadOpen && notifications}
      </UploadDialog>
      {!uploadOpen && notifications}
    </main>
  )
}
