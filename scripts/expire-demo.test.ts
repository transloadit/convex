// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('expiry credentials are scoped to cleanup steps, not dependency installation', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/expire-demo.yml', import.meta.url),
    'utf8',
  )
  expect(workflow).not.toMatch(/^    env:/m)
  expect(workflow.match(/^          CONVEX_ADMIN_KEY:/gm)).toHaveLength(2)
  expect(workflow.match(/^          TRANSLOADIT_SECRET:/gm)).toHaveLength(2)
})
