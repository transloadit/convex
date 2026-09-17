'use client'

import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useConvexAuth, useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type UploadStage,
  useAssemblyEvents,
  useWeddingUppy,
} from './useWeddingUppy'
import { type Toast, WeddingLayout } from './WeddingLayout'

type WeddingAssemblyOptionsResponse = {
  assemblyOptions: AssemblyOptions
  params?: Record<string, unknown>
}

const galleryAlbum = 'wedding-gallery'

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
