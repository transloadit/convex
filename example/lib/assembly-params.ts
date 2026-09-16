const secretKeys = new Set(['secret', 'key', 'credentials', 'authSecret', 'authKey'])

const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretKeys.has(key) ? '***' : redactSecrets(item),
    ]),
  )
}

// Only this redacted copy belongs in the example's diagnostic panel or screenshots.
export const parseDisplayParams = (params: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(params)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return redactSecrets(parsed) as Record<string, unknown>
  } catch {
    return null
  }
}
