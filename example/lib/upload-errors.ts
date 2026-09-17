import { ConvexError } from 'convex/values'

export const uploadErrorCodes = [
  'NAME_REQUIRED',
  'FILES_REQUIRED',
  'AUTH_REQUIRED',
  'ACCESS_REQUIRED',
  'LOGIN_FAILED',
  'INVITE_REQUIRED',
  'UPLOAD_LIMIT',
  'UPLOAD_FAILED',
  'STATUS_FAILED',
] as const

export type UploadErrorCode = (typeof uploadErrorCodes)[number]

export const getUploadErrorCode = (error: unknown): UploadErrorCode => {
  const seen = new Set<unknown>()
  let current = error
  // Transloadit wraps signing errors. Follow their causes without exposing raw server messages.
  while (current && !seen.has(current)) {
    seen.add(current)
    const code =
      current instanceof ConvexError
        ? current.data
        : current instanceof Error
          ? current.message
          : current
    const known = uploadErrorCodes.find((candidate) => candidate === code)
    if (known) return known
    current = current instanceof Error && 'cause' in current ? current.cause : undefined
  }
  return 'UPLOAD_FAILED'
}
