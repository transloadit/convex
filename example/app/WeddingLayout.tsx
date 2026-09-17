'use client'

import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { uppyLocales } from '../i18n/uppy'
import { galleryRetentionMs } from '../lib/gallery'
import { maxGuestNameLength } from '../lib/guest-name'
import type { UploadErrorCode } from '../lib/upload-errors'
import { wedding } from '../lib/wedding'
import { LanguageSwitcher } from './LanguageSwitcher'
import { stageRank, type UploadStage, type WeddingUppy } from './useWeddingUppy'

const Dashboard = dynamic(() => import('@uppy/react/dashboard'), { ssr: false })

export type Toast = { id: string; guestName?: string; fileCount?: number }
export type UploadSuccess = { id: string; count: number }

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
  children,
}: {
  uppy: WeddingUppy
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
  children: ReactNode
}) => {
  const t = useTranslations()
  const locale = useLocale()
  const formId = useId()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [visibleSuccess, setVisibleSuccess] = useState<UploadSuccess | null>(null)
  useEffect(() => {
    if (!uploadSuccess) return
    setUploadOpen(false)
    setVisibleSuccess(uploadSuccess)
    const timer = setTimeout(() => setVisibleSuccess(null), 8000)
    return () => clearTimeout(timer)
  }, [uploadSuccess])
  const payloadText = assemblyParams ? JSON.stringify(assemblyParams, null, 2) : null
  const notifications = Boolean(visibleSuccess || toasts?.length) && (
    <div className={`toast-stack${uploadOpen ? ' toast-inline' : ''}`} role="status">
      {visibleSuccess && (
        <div className="toast toast-success" data-testid="upload-success">
          <span className="toast-check" aria-hidden="true">
            ✓
          </span>
          <span>{t('upload.success', { count: visibleSuccess.count })}</span>
          <button
            type="button"
            onClick={() => setVisibleSuccess(null)}
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
    <main className="page" data-auth-state={authState ?? 'local'} suppressHydrationWarning>
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
            onClick={() => setUploadOpen(true)}
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

      <section className="album-collection" id="memories" aria-labelledby="collection-title">
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
          {Number.isFinite(galleryRetentionMs)
            ? t('album.demoRetention', { hours: galleryRetentionMs / 3600000 })
            : t('album.demoAll')}
          <br />
          {t.rich('album.credits', {
            transloadit: (chunks) => <a href="https://transloadit.com/">{chunks}</a>,
            convex: (chunks) => <a href="https://github.com/transloadit/convex">{chunks}</a>,
          })}
        </p>
      </footer>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)}>
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
        <div data-testid="uppy-dashboard">
          <Dashboard
            uppy={uppy}
            disabled={isUploading}
            locale={uppyLocales[locale]}
            height={280}
            width="100%"
            proudlyDisplayPoweredByUppy={false}
            hideUploadButton
            // Keep retries on our validated submit path so they also close the dialog on success.
            hideRetryButton
            note={t('upload.limit')}
          />
        </div>
        <div className="cta">
          <button
            className="button"
            type="submit"
            form={formId}
            disabled={isUploading || (authState && authState !== 'authenticated')}
            data-testid="start-upload"
          >
            {isUploading ? t('upload.uploading') : t('upload.add')}
          </button>
          {(isUploading || stage === 'processing') && (
            <p className="upload-hint">{t('upload.keepBrowsing')}</p>
          )}
        </div>
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
