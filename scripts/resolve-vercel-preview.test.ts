// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('./env.ts', () => ({ loadEnv: () => {} }))
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('resolves the manual dispatch branch preview when metadata is not available', async () => {
  for (const [key, value] of Object.entries({
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_SHA: 'test-sha',
    GITHUB_HEAD_REF: '',
    GITHUB_REF_NAME: 'release-fixes',
    GITHUB_EVENT_PATH: '',
    VERCEL_PROJECT_SLUG: 'gallery',
    VERCEL_TEAM_SLUG: 'team',
    VERCEL_PREVIEW_DEPLOY_HOOK: '',
    VERCEL_PROTECTION_BYPASS: '',
  })) {
    vi.stubEnv(key, value)
  }
  const preview = 'https://gallery-git-release-fixes-team.vercel.app'
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/deployments?sha=test-sha')) return Response.json([])
      if (url.endsWith('/check-runs')) return Response.json({ check_runs: [] })
      if (url === preview + '/') return new Response('Ready')
      throw new Error('Unexpected request: ' + url)
    }),
  )
  // Let an incorrect implementation leave the polling loop immediately instead of waiting minutes.
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(360_001)
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const exit = new Error('Preview resolution complete')
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw exit
  })
  await import('./resolve-vercel-preview.ts').catch((error) => {
    if (error !== exit) throw error
  })
  expect(output).toHaveBeenCalledWith(preview)
})
