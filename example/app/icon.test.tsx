// @vitest-environment node
import { expect, test } from 'vitest'
import Icon from './icon'

test('provides a real album icon instead of requesting a missing favicon', async () => {
  const response = Icon()
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
})
