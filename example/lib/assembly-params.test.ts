import { expect, test } from 'vitest'
import { parseDisplayParams } from './assembly-params'

test('diagnostic params retain useful fields without exposing nested credentials', () => {
  const params = parseDisplayParams(
    JSON.stringify({
      auth: { key: 'private-auth-key' },
      steps: { store: { secret: 'private-storage-secret', key: 'private-storage-key' } },
      nested: [{ credentials: 'private-credential', authSecret: 'private-secret' }],
      fields: { album: 'wedding', fileCount: 3 },
    }),
  )
  expect(JSON.stringify(params)).not.toContain('private-')
  expect(params?.fields).toEqual({ album: 'wedding', fileCount: 3 })
})

test.each(['invalid', 'null', '[]', '123'])('ignores invalid diagnostic params: %s', (params) => {
  expect(parseDisplayParams(params)).toBeNull()
})
