import { ConvexError } from 'convex/values'
import { isValidGuestName } from './guest-name'

export const album = 'wedding-gallery'
export const getInviteCode = () => process.env.WEDDING_UPLOAD_CODE?.trim() || ''

export const inviteVersion = async () => {
  const bytes = new TextEncoder().encode(`wedding-access:v1:${getInviteCode()}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const validateEntry = (name: unknown, code: unknown) => {
  if (!isValidGuestName(name)) throw new ConvexError('NAME_REQUIRED')
  const required = getInviteCode()
  if (required && (typeof code !== 'string' || code.trim() !== required)) {
    throw new ConvexError('INVITE_REQUIRED')
  }
  return name.trim()
}
