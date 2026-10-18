'use client'

import type Uppy from '@uppy/core'
import type { AssemblyResponse } from '@uppy/transloadit'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
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

export const useWeddingUppy = (
  getAssemblyOptions: () => Promise<AssemblyOptions>,
  enabled: boolean,
) => {
  const locale = useLocale()
  const t = useTranslations('errors')
  const getAssemblyOptionsRef = useRef(getAssemblyOptions)
  const translateError = useRef(t)

  useEffect(() => {
    getAssemblyOptionsRef.current = getAssemblyOptions
    translateError.current = t
  }, [getAssemblyOptions, t])

  const [loaded, setLoaded] = useState<ReturnType<
    typeof import('./createWeddingUppy').createWeddingUppy
  > | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // The guest flips this on once; closing the dialog keeps the instance and selected files.
    // Leaving the album unmounts this hook. Chunk failures deliberately ask for a page reload.
    if (!enabled) return
    let active = true
    let instance: WeddingUppy | undefined
    void import('./createWeddingUppy')
      .then(({ createWeddingUppy }) => {
        if (!active) return
        const value = createWeddingUppy(async () => {
          try {
            return await getAssemblyOptionsRef.current()
          } catch (error) {
            // Uppy also shows signing failures in its informer; never expose server error details.
            throw Object.assign(new Error(translateError.current(getUploadErrorCode(error))), {
              cause: error,
            })
          }
        })
        instance = value.uppy
        ;(window as { __uppy?: WeddingUppy }).__uppy = instance
        setLoaded(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      instance?.destroy()
      const testWindow = window as { __uppy?: WeddingUppy }
      if (testWindow.__uppy === instance) delete testWindow.__uppy
    }
  }, [enabled])

  useEffect(() => {
    loaded?.uppy.setOptions({ locale: loaded.locales[locale] })
  }, [loaded, locale])

  return { uppy: loaded?.uppy ?? null, failed }
}

export const useAssemblyEvents = (
  uppy: WeddingUppy | null,
  setAssemblyId: (id: string) => void,
  setStage: (stage: UploadStage) => void,
) => {
  useEffect(() => {
    if (!uppy) return
    const handleAssemblyCreated = (assembly: AssemblyResponse) => {
      if (!assembly.assembly_id) return
      setAssemblyId(assembly.assembly_id)
      setStage('uploading')
    }
    const handleExecuting = () => {
      setStage('processing')
    }
    const handleError = () => {
      setStage('error')
    }
    uppy.on('transloadit:assembly-created', handleAssemblyCreated)
    uppy.on('transloadit:assembly-executing', handleExecuting)
    uppy.on('transloadit:assembly-error', handleError)
    return () => {
      uppy.off('transloadit:assembly-created', handleAssemblyCreated)
      uppy.off('transloadit:assembly-executing', handleExecuting)
      uppy.off('transloadit:assembly-error', handleError)
    }
  }, [uppy, setAssemblyId, setStage])
}
