'use client'

import Uppy from '@uppy/core'
import Transloadit from '@uppy/transloadit'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { uppyLocales } from '../i18n/uppy'
import type { AssemblyOptions } from '../lib/transloadit'
import { getUploadErrorCode } from '../lib/upload-errors'

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
  const locale = useLocale()
  const t = useTranslations('errors')
  const getAssemblyOptionsRef = useRef(getAssemblyOptions)
  const translateError = useRef(t)

  useEffect(() => {
    getAssemblyOptionsRef.current = getAssemblyOptions
    translateError.current = t
  }, [getAssemblyOptions, t])

  const [uppy] = useState(() =>
    new Uppy<Record<string, unknown>, Record<string, unknown>>({
      autoProceed: false,
      locale: uppyLocales[locale],
      restrictions: {
        allowedFileTypes: ['image/*', 'video/*'],
        maxNumberOfFiles: 12,
      },
    }).use(Transloadit, {
      waitForEncoding: true,
      assemblyOptions: async () => {
        try {
          return await getAssemblyOptionsRef.current()
        } catch (error) {
          // Uppy also shows signing failures in its own informer, outside our error panel.
          throw Object.assign(new Error(translateError.current(getUploadErrorCode(error))), {
            cause: error,
          })
        }
      },
    }),
  )

  useEffect(() => {
    uppy.setOptions({ locale: uppyLocales[locale] })
  }, [uppy, locale])

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
