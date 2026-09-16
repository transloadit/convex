'use client'

import Uppy, { type UploadResult } from '@uppy/core'
import Transloadit from '@uppy/transloadit'
import { useEffect, useRef, useState } from 'react'
import type { AssemblyOptions } from '../lib/transloadit'

export type WeddingUppy = Uppy<Record<string, unknown>, Record<string, unknown>>

export type UploadStage = 'idle' | 'creating' | 'uploading' | 'processing' | 'complete' | 'error'

export const stageRank: Record<UploadStage, number> = {
  idle: 0,
  creating: 1,
  uploading: 2,
  processing: 3,
  complete: 4,
  error: 5,
}

export const shouldAdvanceStage = (current: UploadStage, next: UploadStage) =>
  stageRank[next] >= stageRank[current]

const resolveAssemblyId = (assembly: unknown): string | null => {
  if (!assembly || typeof assembly !== 'object') return null
  const record = assembly as Record<string, unknown>
  if (typeof record.assembly_id === 'string') return record.assembly_id
  if (typeof record.assemblyId === 'string') return record.assemblyId
  if (typeof record.id === 'string') return record.id
  return null
}

export const useWeddingUppy = (getAssemblyOptions: () => Promise<AssemblyOptions>): WeddingUppy => {
  const getAssemblyOptionsRef = useRef(getAssemblyOptions)

  useEffect(() => {
    getAssemblyOptionsRef.current = getAssemblyOptions
  }, [getAssemblyOptions])

  const [uppy] = useState(() =>
    new Uppy<Record<string, unknown>, Record<string, unknown>>({
      autoProceed: false,
      restrictions: {
        allowedFileTypes: ['image/*', 'video/*'],
        maxNumberOfFiles: 12,
      },
    }).use(Transloadit, {
      waitForEncoding: true,
      assemblyOptions: () => getAssemblyOptionsRef.current(),
    }),
  )

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as { __uppy?: WeddingUppy }).__uppy = uppy
    }
    return () => {
      // Avoid StrictMode dev cleanup nuking plugins on the shared instance.
      if (process.env.NODE_ENV === 'production') {
        uppy.destroy()
      }
    }
  }, [uppy])

  return uppy
}

export const formatUploadFailure = (
  result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
) => {
  const failed = result.failed ?? []
  if (failed.length === 0) return null
  const summary = failed
    .map((file) => {
      const name = file.name ?? file.id
      const errorValue = file.error as unknown
      const message =
        typeof errorValue === 'string'
          ? errorValue
          : typeof (errorValue as { message?: unknown })?.message === 'string'
            ? (errorValue as { message: string }).message
            : 'Unknown error'
      return `${name}: ${message}`
    })
    .join('; ')
  return `Upload failed (${failed.length} file${failed.length === 1 ? '' : 's'}). ${summary}`
}

export const useAssemblyEvents = (
  uppy: WeddingUppy,
  setAssemblyId: (id: string) => void,
  setStage: (stage: UploadStage) => void,
) => {
  useEffect(() => {
    const handleAssemblyCreated = (assembly: unknown) => {
      const nextId = resolveAssemblyId(assembly)
      if (!nextId) return
      setAssemblyId(nextId)
      setStage('uploading')
    }
    const handleComplete = () => {
      setStage('processing')
    }
    uppy.on('transloadit:assembly-created', handleAssemblyCreated)
    uppy.on('transloadit:complete', handleComplete)
    return () => {
      uppy.off('transloadit:assembly-created', handleAssemblyCreated)
      uppy.off('transloadit:complete', handleComplete)
    }
  }, [uppy, setAssemblyId, setStage])
}
