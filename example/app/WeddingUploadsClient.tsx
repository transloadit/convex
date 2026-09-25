'use client'

import { useAction, useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react'
import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GalleryResult, StorageGalleryAsset } from '../lib/gallery'
import { getGuestName, isValidGuestName } from '../lib/guest-name'
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
import { getUploadErrorCode, type UploadErrorCode } from '../lib/upload-errors'
import { CloudAlbumGate, LocalAlbumGate } from './AlbumGate'
import { Gallery } from './Gallery'
import { Providers } from './providers'
import {
  shouldAdvanceStage,
  type UploadStage,
  useAssemblyEvents,
  useWeddingUppy,
} from './useWeddingUppy'
import { type Toast, type UploadSuccess, WeddingLayout } from './WeddingLayout'

type WeddingAssemblyOptionsResponse = {
  assemblyOptions: AssemblyOptions
  params?: Record<string, unknown>
}

const useUploadToasts = (
  assemblies: AssemblyResponse[] | undefined,
  ownAssemblyId: string | null,
) => {
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

      if (assembly.assemblyId === ownAssemblyId) return
      const fields = assembly.fields ?? {}
      const guestName = getGuestName(fields.guestName)
      const fileCount = typeof fields.fileCount === 'number' ? fields.fileCount : undefined
      setToasts((prev) => [...prev, { id, guestName, fileCount }])
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        timers.current.delete(id)
      }, 6000)
      timers.current.set(id, timer)
    })
  }, [assemblies, ownAssemblyId])

  return toasts
}

type WeddingAssemblyArgs = {
  fileCount: number
  guestName: string
}

const createWeddingAssemblyOptionsRef = makeFunctionReference<
  'action',
  WeddingAssemblyArgs,
  WeddingAssemblyOptionsResponse
>('wedding:createWeddingAssemblyOptions')
const listAssembliesRef = makeFunctionReference<
  'query',
  { status?: string; limit?: number },
  AssemblyResponse[]
>('transloadit:listAssemblies')
const listResultsRef = makeFunctionReference<
  'query',
  { assemblyId: string; stepName?: string; limit?: number },
  AssemblyResultResponse[]
>('transloadit:listResults')
const listGalleryRef = makeFunctionReference<'query', { limit?: number }, GalleryResult[]>(
  'wedding:listGallery',
)
const listMediaRef = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<StorageGalleryAsset>
>('media:list')
const galleryPageSize = 24
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

const LocalWeddingUploads = ({
  initialName,
  onLeave,
}: {
  initialName: string
  onLeave: () => void
}) => {
  const [assemblyId, setAssemblyId] = useState<string | null>(null)
  const [assemblyParams, setAssemblyParams] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<string>('pending')
  const [results, setResults] = useState<GalleryResult[]>([])
  const [assemblyStatus, setAssemblyStatus] = useState<AssemblyStatus | null>(null)
  const [error, setError] = useState<UploadErrorCode | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [guestName, setGuestName] = useState(initialName)
  const [uploadSuccess, setUploadSuccess] = useState<UploadSuccess | null>(null)
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
        guestName: guestName.trim(),
      }),
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(getUploadErrorCode(payload.error))
      }
      return (await response.json()) as WeddingAssemblyOptionsResponse
    })
    assemblyOptionsPromise.current = promise
    const resolved = await promise
    setAssemblyParams(resolved.params ?? null)
    return resolved.assemblyOptions
  }, [guestName])

  const uppy = useWeddingUppy(getAssemblyOptions)

  useAssemblyEvents(uppy, setAssemblyId, setStage)

  const startUpload = async () => {
    setError(null)
    if (!isValidGuestName(guestName)) {
      setError('NAME_REQUIRED')
      setStage('error')
      return
    }
    setStage('creating')
    const files = uppy.getFiles()
    if (!files.length) {
      setError('FILES_REQUIRED')
      setStage('error')
      return
    }

    setIsUploading(true)
    setAssemblyId(null)
    setAssemblyStatus(null)
    setStatus('pending')
    assemblyOptionsPromise.current = null
    fileCountRef.current = files.length
    try {
      const result = await uppy.upload()
      if (!result || result.failed?.length || !result.successful?.length) {
        throw new Error('UPLOAD_FAILED')
      }
      setUploadSuccess({ id: crypto.randomUUID(), count: result.successful.length })
      setError(null)
      setStage('complete')
      uppy.clear()
    } catch (err) {
      setError(getUploadErrorCode(err))
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
    const request = new AbortController()
    const controller = pollAssembly({
      intervalMs: 4000,
      refresh: async () => {
        const params = new URLSearchParams({ assemblyId, refresh: '1' })
        const response = await fetch(`/api/assemblies?${params.toString()}`, {
          signal: request.signal,
        })
        if (!response.ok) throw new Error('STATUS_FAILED')
        const data = (await response.json()) as {
          status: AssemblyResponse | null
          results: GalleryResult[]
        }
        // A response for the previous batch must not complete or replace the next batch's state.
        if (request.signal.aborted) return
        const parsed = parseAssemblyStatus(data.status?.raw ?? null)
        setAssemblyStatus(parsed)
        setStatus(parsed && typeof parsed.ok === 'string' ? parsed.ok : 'pending')
        setResults(data.results ?? [])
        setError((current) => (current === 'STATUS_FAILED' ? null : current))
      },
      onError: () => {
        if (!request.signal.aborted) setError('STATUS_FAILED')
      },
    })
    return () => {
      controller.stop()
      request.abort()
    }
  }, [assemblyId, needsPolling])

  return (
    <WeddingLayout
      uppy={uppy}
      guestName={guestName}
      onGuestNameChange={setGuestName}
      onLeave={onLeave}
      isUploading={isUploading}
      onUpload={() => void startUpload()}
      error={error}
      assemblyId={assemblyId}
      assemblyParams={assemblyParams}
      status={status}
      stage={stage}
      uploadSuccess={uploadSuccess}
    >
      <Gallery results={results} />
    </WeddingLayout>
  )
}

const CloudWeddingUploads = ({
  initialName,
  onLeave,
}: {
  initialName: string
  onLeave: () => void
}) => {
  const [assemblyParams, setAssemblyParams] = useState<Record<string, unknown> | null>(null)
  const [assemblyId, setAssemblyId] = useState<string | null>(null)
  const [error, setError] = useState<UploadErrorCode | null>(null)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [guestName, setGuestName] = useState(initialName)
  const [uploadSuccess, setUploadSuccess] = useState<UploadSuccess | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const { isAuthenticated, isLoading } = useConvexAuth()
  const assemblyOptionsPromise = useRef<Promise<WeddingAssemblyOptionsResponse> | null>(null)
  const fileCountRef = useRef(0)
  const createAssemblyOptions = useAction(createWeddingAssemblyOptionsRef)
  const refreshAssembly = useAction(refreshAssemblyRef)
  const getAssemblyOptions = useCallback(async () => {
    if (!isAuthenticated) {
      throw new Error('AUTH_REQUIRED')
    }
    if (assemblyOptionsPromise.current) {
      const cached = await assemblyOptionsPromise.current
      return cached.assemblyOptions
    }
    const fileCount = Math.max(1, fileCountRef.current || 1)
    const promise = createAssemblyOptions({
      fileCount,
      guestName: guestName.trim(),
    }) as Promise<WeddingAssemblyOptionsResponse>
    assemblyOptionsPromise.current = promise
    const resolved = await promise
    setAssemblyParams(resolved.params ?? null)
    return resolved.assemblyOptions
  }, [createAssemblyOptions, guestName, isAuthenticated])
  const uppy = useWeddingUppy(getAssemblyOptions)
  const status = useQuery(getAssemblyStatusRef, assemblyId ? { assemblyId } : 'skip')
  const results = useQuery(listResultsRef, assemblyId ? { assemblyId } : 'skip')
  const albumResults = useQuery(listGalleryRef, { limit: 80 })
  // Private photos: canonical receipts only; the media route authorizes every image request.
  const media = usePaginatedQuery(listMediaRef, {}, { initialNumItems: galleryPageSize })
  const assemblies = useQuery(listAssembliesRef, {
    status: ASSEMBLY_STATUS_COMPLETED,
    limit: 12,
  })
  const toasts = useUploadToasts(assemblies ?? undefined, assemblyId)

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
    let active = true
    const controller = pollAssembly({
      intervalMs: 8000,
      refresh: async () => {
        await refreshAssembly({ assemblyId })
        if (active) setError((current) => (current === 'STATUS_FAILED' ? null : current))
      },
      onError: () => {
        if (active) setError('STATUS_FAILED')
      },
    })
    return () => {
      active = false
      controller.stop()
    }
  }, [assemblyId, needsPolling, refreshAssembly])

  const statusOk = parsedStatus && typeof parsedStatus.ok === 'string' ? parsedStatus.ok : 'pending'
  const galleryResults = albumResults ?? results ?? []

  const startUpload = async () => {
    setError(null)
    if (!isValidGuestName(guestName)) {
      setError('NAME_REQUIRED')
      setStage('error')
      return
    }
    setStage('creating')
    const files = uppy.getFiles()
    if (!files.length) {
      setError('FILES_REQUIRED')
      setStage('error')
      return
    }
    if (!isAuthenticated) {
      setError('AUTH_REQUIRED')
      setStage('error')
      return
    }

    setIsUploading(true)
    setAssemblyId(null)
    assemblyOptionsPromise.current = null
    fileCountRef.current = files.length
    try {
      const result = await uppy.upload()
      if (!result || result.failed?.length || !result.successful?.length) {
        throw new Error('UPLOAD_FAILED')
      }
      setUploadSuccess({ id: crypto.randomUUID(), count: result.successful.length })
      setError(null)
      setStage('complete')
      uppy.clear()
    } catch (err) {
      setError(getUploadErrorCode(err))
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
      onLeave={onLeave}
      isUploading={isUploading}
      onUpload={() => void startUpload()}
      error={error}
      assemblyId={assemblyId}
      assemblyParams={assemblyParams}
      status={statusOk}
      stage={stage}
      uploadSuccess={uploadSuccess}
      toasts={toasts}
      authState={isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'guest'}
    >
      <Gallery
        results={galleryResults}
        storageAssets={media.results}
        onLoadMore={
          media.status === 'CanLoadMore' ? () => media.loadMore(galleryPageSize) : undefined
        }
      />
    </WeddingLayout>
  )
}

export default function WeddingUploadsClient({ convexUrl }: { convexUrl?: string | null }) {
  if (!convexUrl) {
    return (
      <LocalAlbumGate>
        {(guest, onLeave) => (
          <LocalWeddingUploads key={guest.userId} initialName={guest.name} onLeave={onLeave} />
        )}
      </LocalAlbumGate>
    )
  }

  return (
    <Providers convexUrl={convexUrl}>
      <CloudAlbumGate>
        {(guest, onLeave) => (
          <CloudWeddingUploads key={guest.userId} initialName={guest.name} onLeave={onLeave} />
        )}
      </CloudAlbumGate>
    </Providers>
  )
}
