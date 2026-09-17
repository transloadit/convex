'use client'

import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useConvexAuth, useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { galleryRetentionLabel as retentionLabel } from '../lib/gallery'
import {
  ASSEMBLY_STATUS_COMPLETED,
  type AssemblyOptions,
  type AssemblyResponse,
  type AssemblyResultResponse,
  type AssemblyStatus,
  getAssemblyStage,
  isAssemblyTerminal,
  parseAssemblyStatus,
  pollAssembly,
} from '../lib/transloadit'
import { Gallery } from './Gallery'
import { Providers } from './providers'
import {
  formatUploadFailure,
  shouldAdvanceStage,
  stageRank,
  type UploadStage,
  useAssemblyEvents,
  useWeddingUppy,
  type WeddingUppy,
} from './useWeddingUppy'

const Dashboard = dynamic(() => import('@uppy/react/dashboard'), {
  ssr: false,
})

type WeddingAssemblyOptionsResponse = {
  assemblyOptions: AssemblyOptions
  params?: Record<string, unknown>
}

type Toast = {
  id: string
  message: string
}

const galleryAlbum = 'wedding-gallery'

const UploadTimeline = ({ stage }: { stage: UploadStage }) => {
  const steps: Array<{ stage: UploadStage; label: string }> = [
    { stage: 'creating', label: 'Assembly created' },
    { stage: 'uploading', label: 'Uploading files' },
    { stage: 'processing', label: 'Processing & storing' },
    { stage: 'complete', label: 'Gallery updated' },
  ]
  const currentRank = stageRank[stage]

  return (
    <div className="timeline" data-testid="upload-timeline">
      {steps.map((step) => {
        const isActive = currentRank >= stageRank[step.stage]
        const isCurrent = stage === step.stage
        return (
          <div
            className={`timeline-step${isActive ? ' active' : ''}${isCurrent ? ' current' : ''}`}
            key={step.stage}
          >
            <span className="timeline-dot" />
            <span className="timeline-label">{step.label}</span>
          </div>
        )
      })}
      {stage === 'error' && <div className="timeline-error">Upload failed. Try again.</div>}
    </div>
  )
}

const useUploadToasts = (assemblies: AssemblyResponse[] | undefined) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef<Set<string>>(new Set())
  const initialized = useRef(false)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer)
      }
      timers.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!assemblies) return
    if (!initialized.current) {
      assemblies.forEach((assembly) => {
        const id = assembly._id ?? assembly.assemblyId ?? `${assembly.createdAt ?? 0}`
        seen.current.add(id)
      })
      initialized.current = true
      return
    }
    const next = [...assemblies].reverse()
    next.forEach((assembly) => {
      const id = assembly._id ?? assembly.assemblyId ?? `${assembly.createdAt ?? 0}`
      if (seen.current.has(id)) return
      seen.current.add(id)

      const fields = assembly.fields ?? {}
      const guestName = typeof fields.guestName === 'string' ? fields.guestName : 'Guest'
      const fileCount = typeof fields.fileCount === 'number' ? fields.fileCount : undefined
      const message = fileCount
        ? `${guestName} uploaded ${fileCount} file${fileCount === 1 ? '' : 's'}`
        : `${guestName} uploaded new files`

      setToasts((prev) => [...prev, { id, message }])
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        timers.current.delete(id)
      }, 6000)
      timers.current.set(id, timer)
    })
  }, [assemblies])

  return toasts
}

type WeddingAssemblyArgs = {
  fileCount: number
  guestName?: string
  uploadCode?: string
}

const createWeddingAssemblyOptionsRef = makeFunctionReference<
  'action',
  WeddingAssemblyArgs,
  WeddingAssemblyOptionsResponse
>('wedding:createWeddingAssemblyOptions')
const listAssembliesRef = makeFunctionReference<
  'query',
  { status?: string; userId?: string; limit?: number },
  AssemblyResponse[]
>('transloadit:listAssemblies')
const listResultsRef = makeFunctionReference<
  'query',
  { assemblyId: string; stepName?: string; limit?: number },
  AssemblyResultResponse[]
>('transloadit:listResults')
const listAlbumResultsRef = makeFunctionReference<
  'query',
  { album: string; limit?: number },
  AssemblyResultResponse[]
>('transloadit:listAlbumResults')
const getAssemblyStatusRef = makeFunctionReference<
  'query',
  { assemblyId: string },
  AssemblyResponse | null
>('transloadit:getAssemblyStatus')
const refreshAssemblyRef = makeFunctionReference<
  'action',
  { assemblyId: string },
  { assemblyId: string; resultCount: number; ok?: string; status?: string }
>('transloadit:refreshAssembly')

const LocalWeddingUploads = () => {
  const [assemblyId, setAssemblyId] = useState<string | null>(null)
  const [assemblyParams, setAssemblyParams] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<string>('pending')
  const [results, setResults] = useState<AssemblyResultResponse[]>([])
  const [assemblyStatus, setAssemblyStatus] = useState<AssemblyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [guestName, setGuestName] = useState('Guest')
  const [uploadCode, setUploadCode] = useState('')
  const assemblyOptionsPromise = useRef<Promise<WeddingAssemblyOptionsResponse> | null>(null)
  const fileCountRef = useRef(0)

  const getAssemblyOptions = useCallback(async () => {
    if (assemblyOptionsPromise.current) {
      const cached = await assemblyOptionsPromise.current
      return cached.assemblyOptions
    }
    const fileCount = Math.max(1, fileCountRef.current || 1)
    const promise = fetch('/api/assemblies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileCount,
        guestName,
        uploadCode,
      }),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error('Failed to create assembly options')
      }
      return (await response.json()) as WeddingAssemblyOptionsResponse
    })
    assemblyOptionsPromise.current = promise
    const resolved = await promise
    setAssemblyParams(resolved.params ?? null)
    return resolved.assemblyOptions
  }, [guestName, uploadCode])

  const uppy = useWeddingUppy(getAssemblyOptions)

  const refreshResults = useCallback(async (id: string, refresh = false) => {
    const params = new URLSearchParams({ assemblyId: id })
    if (refresh) params.set('refresh', '1')
    const response = await fetch(`/api/assemblies?${params.toString()}`)
    if (!response.ok) {
      throw new Error('Failed to load assembly status')
    }
    const data = (await response.json()) as {
      status: AssemblyResponse | null
      results: AssemblyResultResponse[]
    }
    const parsedStatus = parseAssemblyStatus(data.status?.raw ?? null)
    setAssemblyStatus(parsedStatus)
    const ok = parsedStatus && typeof parsedStatus.ok === 'string' ? parsedStatus.ok : 'pending'
    setStatus(ok)
    setResults(data.results ?? [])
  }, [])

  useAssemblyEvents(uppy, setAssemblyId, setStage)

  const startUpload = async () => {
    setError(null)
    setStage('creating')
    const files = uppy.getFiles()
    if (!files.length) {
      setError('Select at least one image or video.')
      setStage('error')
      return
    }

    setIsUploading(true)
    assemblyOptionsPromise.current = null
    fileCountRef.current = files.length
    try {
      const result = await uppy.upload()
      if (!result) {
        throw new Error('Upload failed')
      }
      const failure = formatUploadFailure(result)
      if (failure) {
        throw new Error(failure)
      }
      setStage('processing')
      if (assemblyId) {
        await refreshResults(assemblyId, true)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      setStage('error')
    } finally {
      setIsUploading(false)
    }
  }

  useEffect(() => {
    const nextStage = getAssemblyStage(assemblyStatus)
    if (!nextStage) return
    if (shouldAdvanceStage(stage, nextStage)) {
      setStage(nextStage)
    }
  }, [assemblyStatus, stage])

  const needsPolling =
    !assemblyStatus || !isAssemblyTerminal(assemblyStatus) || results.length === 0
  useEffect(() => {
    if (!assemblyId || !needsPolling) return
    const controller = pollAssembly({
      intervalMs: 4000,
      refresh: () => refreshResults(assemblyId, true),
      onError: (err) => setError(err.message),
    })
    return () => controller.stop()
  }, [assemblyId, needsPolling, refreshResults])

  return (
    <WeddingLayout
      uppy={uppy}
      guestName={guestName}
      onGuestNameChange={setGuestName}
      uploadCode={uploadCode}
      onUploadCodeChange={setUploadCode}
      isUploading={isUploading}
      onUpload={() => void startUpload()}
      error={error}
      assemblyId={assemblyId}
      assemblyParams={assemblyParams}
      status={status}
      stage={stage}
    >
      <Gallery results={results} />
    </WeddingLayout>
  )
}

const CloudWeddingUploads = () => {
  const [assemblyParams, setAssemblyParams] = useState<Record<string, unknown> | null>(null)
  const [assemblyId, setAssemblyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [guestName, setGuestName] = useState('Guest')
  const [uploadCode, setUploadCode] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const { signIn } = useAuthActions()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const assemblyOptionsPromise = useRef<Promise<WeddingAssemblyOptionsResponse> | null>(null)
  const fileCountRef = useRef(0)
  const createAssemblyOptions = useAction(createWeddingAssemblyOptionsRef)
  const refreshAssembly = useAction(refreshAssemblyRef)
  const getAssemblyOptions = useCallback(async () => {
    if (!isAuthenticated) {
      throw new Error('Authentication required.')
    }
    if (assemblyOptionsPromise.current) {
      const cached = await assemblyOptionsPromise.current
      return cached.assemblyOptions
    }
    const fileCount = Math.max(1, fileCountRef.current || 1)
    const promise = createAssemblyOptions({
      fileCount,
      guestName,
      uploadCode,
    }) as Promise<WeddingAssemblyOptionsResponse>
    assemblyOptionsPromise.current = promise
    const resolved = await promise
    setAssemblyParams(resolved.params ?? null)
    return resolved.assemblyOptions
  }, [createAssemblyOptions, guestName, uploadCode, isAuthenticated])
  const uppy = useWeddingUppy(getAssemblyOptions)
  const status = useQuery(getAssemblyStatusRef, assemblyId ? { assemblyId } : 'skip')
  const results = useQuery(listResultsRef, assemblyId ? { assemblyId } : 'skip')
  const albumResults = useQuery(listAlbumResultsRef, {
    album: galleryAlbum,
    limit: 80,
  })
  const assemblies = useQuery(listAssembliesRef, {
    status: ASSEMBLY_STATUS_COMPLETED,
    limit: 12,
  })
  const toasts = useUploadToasts(assemblies ?? undefined)

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    let cancelled = false
    void signIn('anonymous').catch((error) => {
      if (cancelled) return
      console.warn('Convex auth sign-in failed', error)
    })
    return () => {
      cancelled = true
    }
  }, [isLoading, isAuthenticated, signIn])

  const parsedStatus = useMemo(() => {
    const candidate =
      status && typeof status === 'object' ? ((status as { raw?: unknown }).raw ?? status) : status
    return parseAssemblyStatus(candidate)
  }, [status])

  useAssemblyEvents(uppy, setAssemblyId, setStage)

  useEffect(() => {
    const nextStage = getAssemblyStage(parsedStatus)
    if (!nextStage) return
    if (shouldAdvanceStage(stage, nextStage)) {
      setStage(nextStage)
    }
  }, [parsedStatus, stage])

  const needsPolling =
    !parsedStatus || !isAssemblyTerminal(parsedStatus) || (results ?? []).length === 0
  useEffect(() => {
    if (!assemblyId || !needsPolling) return
    const controller = pollAssembly({
      intervalMs: 8000,
      refresh: async () => {
        await refreshAssembly({ assemblyId })
      },
      onError: (err) => setError(err.message),
    })
    return () => controller.stop()
  }, [assemblyId, needsPolling, refreshAssembly])

  const statusOk = parsedStatus && typeof parsedStatus.ok === 'string' ? parsedStatus.ok : 'pending'
  const galleryResults = albumResults ?? results ?? []

  const startUpload = async () => {
    setError(null)
    setStage('creating')
    const files = uppy.getFiles()
    if (!files.length) {
      setError('Select at least one image or video.')
      setStage('error')
      return
    }
    if (!isAuthenticated) {
      setError('Signing you in...')
      setStage('error')
      return
    }

    setIsUploading(true)
    assemblyOptionsPromise.current = null
    fileCountRef.current = files.length
    try {
      const result = await uppy.upload()
      if (!result) {
        throw new Error('Upload failed')
      }
      const failure = formatUploadFailure(result)
      if (failure) {
        throw new Error(failure)
      }
      setStage('processing')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      setStage('error')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <WeddingLayout
      uppy={uppy}
      guestName={guestName}
      onGuestNameChange={setGuestName}
      uploadCode={uploadCode}
      onUploadCodeChange={setUploadCode}
      isUploading={isUploading}
      onUpload={() => void startUpload()}
      error={error}
      assemblyId={assemblyId}
      assemblyParams={assemblyParams}
      status={statusOk}
      stage={stage}
      toasts={toasts}
      authState={isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'guest'}
    >
      <Gallery results={galleryResults} />
    </WeddingLayout>
  )
}

const WeddingLayout = ({
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
  children: React.ReactNode
}) => {
  const [copied, setCopied] = useState(false)
  const payloadText = assemblyParams ? JSON.stringify(assemblyParams, null, 2) : null

  const handleCopy = async () => {
    if (!payloadText) return
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(payloadText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="page" data-auth-state={authState ?? 'local'} suppressHydrationWarning>
      <section className="panel">
        <h1 className="headline">Eden & Nico Wedding Gallery</h1>
        <p className="subhead">
          Share your favorite moments — drop photos and short clips below and we’ll add them to the
          live gallery.
        </p>
        {authState && authState !== 'authenticated' && (
          <p className="status" data-testid="auth-status">
            {authState === 'loading' ? 'Signing you in...' : 'Signing you in as a guest.'}
          </p>
        )}
        <label className="input">
          <span>Your name</span>
          <input
            value={guestName}
            onChange={(event) => onGuestNameChange(event.target.value)}
            placeholder="Guest"
          />
        </label>
        <label className="input">
          <span>Invite code</span>
          <input
            value={uploadCode}
            onChange={(event) => onUploadCodeChange(event.target.value)}
            placeholder="Optional if the couple shared one"
            type="password"
          />
        </label>
        <div data-testid="uppy-dashboard">
          <Dashboard
            uppy={uppy}
            height={360}
            width="100%"
            proudlyDisplayPoweredByUppy={false}
            hideUploadButton
            note={`Add photos/videos. Gallery shows ${retentionLabel} to limit spam.`}
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
            {isUploading ? 'Uploading…' : 'Upload to the gallery'}
          </button>
        </div>
        <UploadTimeline stage={stage} />
        {error && (
          <p className="status" data-testid="upload-error">
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
      </section>
      <section className="panel">
        <h2 className="headline">Live gallery</h2>
        <p className="subhead">
          Curated highlights processed by Transloadit — resized images and encoded videos.
        </p>
        {children}
        <p className="status">
          Gallery shows the most recent uploads (retention {retentionLabel}). Files are persisted in
          R2 via Transloadit’s Cloudflare store robot. Built with{' '}
          <a href="https://github.com/transloadit/convex">@transloadit/convex</a> and{' '}
          <a href="https://transloadit.com/">Transloadit</a>.
        </p>
      </section>
      {toasts && toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

export default function WeddingUploadsClient({ convexUrl }: { convexUrl?: string | null }) {
  const [isHydrated, setIsHydrated] = useState(false)
  const [resolvedConvexUrl, setResolvedConvexUrl] = useState<string | null>(() => {
    if (convexUrl) return convexUrl
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return params.get('convexUrl')
  })

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (convexUrl) {
      setResolvedConvexUrl(convexUrl)
      return
    }
    if (resolvedConvexUrl) {
      return
    }
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('convexUrl')
    if (fromQuery) {
      setResolvedConvexUrl(fromQuery)
    }
  }, [convexUrl, resolvedConvexUrl])
  if (!isHydrated) {
    return null
  }
  const hasConvex = Boolean(resolvedConvexUrl)
  if (!hasConvex) {
    return <LocalWeddingUploads />
  }

  return (
    <Providers convexUrl={resolvedConvexUrl ?? ''}>
      <CloudWeddingUploads />
    </Providers>
  )
}
