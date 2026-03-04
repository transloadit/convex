import type { TransloaditResult } from './resultTypes.ts'

const extractUrlFromContainer = (container: Record<string, unknown>) => {
  const candidates = [
    container.ssl_url,
    container.sslUrl,
    container.url,
    container.cdn_url,
    container.cdnUrl,
    container.storage_url,
    container.storageUrl,
    container.result_url,
    container.resultUrl,
    container.signed_url,
    container.signedUrl,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }
  return undefined
}

const extractNestedUrl = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return extractUrlFromContainer(value as Record<string, unknown>)
}

export const getResultUrl = (result: TransloaditResult) => {
  const direct = extractUrlFromContainer(result as Record<string, unknown>)
  if (direct) return direct

  const nestedKeys = ['meta', 'metadata', 'result', 'results', 'file', 'data']
  for (const key of nestedKeys) {
    const nested = extractNestedUrl((result as Record<string, unknown>)[key])
    if (nested) return nested
  }

  const urlsValue = (result as Record<string, unknown>).urls
  const urlsNested = extractNestedUrl(urlsValue)
  if (urlsNested) return urlsNested

  const urlValue = (result as Record<string, unknown>).url
  const urlNested = extractNestedUrl(urlValue)
  if (urlNested) return urlNested

  return undefined
}

export const getResultOriginalKey = (result: TransloaditResult) => {
  const raw = (result as TransloaditResult & { raw?: unknown }).raw
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rawRecord = raw as Record<string, unknown>
    const originalId = rawRecord.original_id
    if (typeof originalId === 'string' && originalId.length > 0) {
      return originalId
    }
    const originalBase = rawRecord.original_basename
    if (typeof originalBase === 'string' && originalBase.length > 0) {
      return originalBase
    }
  }

  if (result.name) return result.name
  if (result.resultId) return result.resultId
  if (result._id) return result._id
  return null
}
