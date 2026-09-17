'use client'

import dynamic from 'next/dynamic'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { galleryRetentionLabel } from '../lib/gallery'
import { wedding } from '../lib/wedding'
import { stageRank, type UploadStage, type WeddingUppy } from './useWeddingUppy'

const Dashboard = dynamic(() => import('@uppy/react/dashboard'), { ssr: false })

export type Toast = { id: string; message: string }

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
          <p className="eyebrow">Through your eyes</p>
          <h2 id={titleId}>Share your memories</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close upload">
          ×
        </button>
      </div>
      <p className="upload-intro">
        The big moments, the little details, the blurry dance-floor photos. We’d love to see them
        all.
      </p>
      {children}
    </dialog>
  )
}

const UploadTimeline = ({ stage }: { stage: UploadStage }) => {
  if (stage === 'idle') return null
  const steps: Array<{ stage: UploadStage; label: string }> = [
    { stage: 'creating', label: 'Getting ready' },
    { stage: 'uploading', label: 'Uploading your memories' },
    { stage: 'processing', label: 'Preparing photos & videos' },
    { stage: 'complete', label: 'Added to the album' },
  ]
  return (
    <div className="timeline" data-testid="upload-timeline" aria-live="polite">
      {steps.map((step) => (
        <div
          key={step.stage}
          className={`timeline-step${stageRank[stage] >= stageRank[step.stage] ? ' active' : ''}${stage === step.stage ? ' current' : ''}`}
        >
          <span className="timeline-dot" />
          {step.label}
        </div>
      ))}
      {stage === 'error' && (
        <div className="timeline-error">
          Something went wrong. Your files are still here to retry.
        </div>
      )}
    </div>
  )
}

export const WeddingLayout = ({
  uppy,
  guestName,
  onGuestNameChange,
  uploadCode,
  onUploadCodeChange,
  isUploading,
  onUpload,
  error,
  assemblyId,
  assemblyParams,
  status,
  stage,
  toasts,
  authState,
  children,
}: {
  uppy: WeddingUppy
  guestName: string
  onGuestNameChange: (value: string) => void
  uploadCode: string
  onUploadCodeChange: (value: string) => void
  isUploading: boolean
  onUpload: () => void
  error: string | null
  assemblyId: string | null
  assemblyParams: Record<string, unknown> | null
  status: string
  stage: UploadStage
  toasts?: Toast[]
  authState?: 'loading' | 'authenticated' | 'guest'
  children: ReactNode
}) => {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const payloadText = assemblyParams ? JSON.stringify(assemblyParams, null, 2) : null
  const notifications = toasts && toasts.length > 0 && (
    <div className={`toast-stack${uploadOpen ? ' toast-inline' : ''}`} role="status">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          {toast.message}
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
        Skip to the photos
      </a>
      <header className="album-header">
        <a className="album-brand" href="#welcome" aria-label={`${wedding.names}, back to the top`}>
          <span className="monogram">{wedding.initials}</span>
          <span className="brand-caption">The wedding album</span>
        </a>
        <button
          className={`button share-button${stage === 'error' ? ' upload-failed' : ''}`}
          type="button"
          onClick={() => setUploadOpen(true)}
          data-testid="open-upload"
          aria-live="polite"
        >
          <Plus />
          {stage === 'error'
            ? 'Upload failed · Retry'
            : isUploading
              ? 'Uploading…'
              : stage === 'processing'
                ? 'Preparing…'
                : 'Share photos'}
        </button>
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
          <p className="eyebrow">The wedding of</p>
          <h1 id="wedding-title">{wedding.names}</h1>
          {wedding.date && <p className="wedding-date">{wedding.date}</p>}
          <p className="cover-message">One day. All our favourite people.</p>
          <a className="explore-link" href="#memories">
            Explore the memories <span aria-hidden="true">↓</span>
          </a>
        </div>
        <span className="cover-note" aria-hidden="true">
          A little love, from every perspective
        </span>
      </section>

      <section className="album-collection" id="memories" aria-labelledby="collection-title">
        <div className="collection-heading">
          <div>
            <p className="eyebrow">The collection</p>
            <h2 id="collection-title">Every little moment.</h2>
          </div>
          <p>
            From the big yes to the last dance.
            <br />
            The day, through everyone’s eyes.
          </p>
        </div>
        {children}
      </section>

      <footer className="album-footer">
        <span className="footer-signature">With love, {wedding.names}</span>
        <p>
          Demo album ·{' '}
          {galleryRetentionLabel === 'all time'
            ? 'All uploads'
            : `Shows uploads from the last ${galleryRetentionLabel}`}
          <br />
          Made with <a href="https://transloadit.com/">Transloadit</a> &{' '}
          <a href="https://github.com/transloadit/convex">Convex</a>
        </p>
      </footer>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)}>
        {authState && authState !== 'authenticated' && (
          <p className="status" data-testid="auth-status">
            Getting your upload ready…
          </p>
        )}
        <div className="upload-fields">
          <label className="input">
            <span>Your name</span>
            <input
              value={guestName}
              onChange={(event) => onGuestNameChange(event.target.value)}
              placeholder="Guest"
            />
          </label>
          <label className="input">
            <span>
              Invite code <span className="optional">if provided</span>
            </span>
            <input
              value={uploadCode}
              onChange={(event) => onUploadCodeChange(event.target.value)}
              type="password"
            />
          </label>
        </div>
        <div data-testid="uppy-dashboard">
          <Dashboard
            uppy={uppy}
            height={280}
            width="100%"
            proudlyDisplayPoweredByUppy={false}
            hideUploadButton
            note="Up to 12 photos or videos at a time."
          />
        </div>
        <div className="cta">
          <button
            className="button"
            type="button"
            onClick={onUpload}
            disabled={isUploading || (authState && authState !== 'authenticated')}
            data-testid="start-upload"
          >
            {isUploading ? 'Uploading…' : 'Add to the album'}
          </button>
          {(isUploading || stage === 'processing') && (
            <p className="upload-hint">You can keep browsing while we finish.</p>
          )}
        </div>
        <UploadTimeline stage={stage} />
        {stage === 'complete' && (
          <button type="button" className="text-button" onClick={() => setUploadOpen(false)}>
            Back to the memories <span aria-hidden="true">→</span>
          </button>
        )}
        {error && (
          <p className="status upload-error" data-testid="upload-error" role="alert">
            {error}
          </p>
        )}
        {(assemblyId || payloadText) && (
          <details className="developer-details">
            <summary>Developer details</summary>
            {assemblyId && (
              <div className="status">
                <p data-testid="assembly-id">ID: {assemblyId}</p>
                <p data-testid="assembly-status">Status: {status}</p>
              </div>
            )}
            {payloadText && (
              <div className="payload-panel" data-testid="assembly-payload">
                <div className="payload-header">
                  <span>createAssembly payload</span>
                  <button className="ghost-button" type="button" onClick={() => void handleCopy()}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="payload-code">{payloadText}</pre>
                <p className="payload-note">
                  Secrets are redacted server-side before returning this payload.
                </p>
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
