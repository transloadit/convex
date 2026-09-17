export const maxGuestNameLength = 100

export const getGuestName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

export const isValidGuestName = (value: unknown): value is string => {
  const name = getGuestName(value)
  return name !== undefined && name.length <= maxGuestNameLength
}
