// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('uses the dispatch branch when GitHub supplies an empty pull request branch', () => {
  const slug = execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./slugify-branch.ts', import.meta.url))],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_HEAD_REF: '',
        GITHUB_REF_NAME: 'Release/Fixes',
        VERCEL_GIT_COMMIT_REF: '',
      },
    },
  )
  expect(slug).toBe('release-fixes')
})
