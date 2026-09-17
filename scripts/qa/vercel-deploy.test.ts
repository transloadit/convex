// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { deployVercel } from './vercel-deploy.ts'

const sha = 'release-commit'
const hook = 'https://example.test/deploy-hook'
const deployment = (id: number) => ({ id, sha, environment: 'Production' })
const json = (body: unknown, status = 200) => Response.json(body, { status })

const harness = (
  options: {
    stale?: boolean
    transient?: boolean
    denied?: boolean
    failed?: boolean
    superseded?: boolean
  } = {},
) => {
  let triggered = false
  let reads = 0
  let triggeredReads = 0
  let statusReads = 0
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url === hook) {
      expect(init?.method).toBe('POST')
      triggered = true
      return json({ job: { id: 'new-hook-job' } })
    }
    if (url.endsWith('/git/ref/heads/main')) {
      return json({
        object: { sha: options.stale || (options.superseded && triggered) ? 'newer-commit' : sha },
      })
    }
    if (url.includes('/deployments?')) {
      reads += 1
      if (options.denied) return json({ message: 'Forbidden' }, 403)
      if (options.transient && reads === 1) return json({ message: 'Unavailable' }, 503)
      if (triggered && ++triggeredReads === 1) return json([deployment(10)])
      return json(triggered ? [deployment(20), deployment(10)] : [deployment(10)])
    }
    if (url.includes('/deployments/10/')) return json([{ state: 'success' }])
    if (url.includes('/deployments/20/')) {
      statusReads += 1
      return json([
        { state: options.failed ? 'failure' : statusReads === 1 ? 'in_progress' : 'success' },
      ])
    }
    throw new Error('Unexpected request: ' + url)
  })
  return {
    fetcher,
    run: () =>
      deployVercel({
        repository: 'owner/repo',
        sha,
        token: 'test-token',
        hook,
        fetcher,
        pause: async () => {},
        attempts: 4,
      }),
  }
}

describe('production deployment verification', () => {
  test('waits for a new deployment instead of accepting an earlier success for the same commit', async () => {
    const { run, fetcher } = harness()
    expect(await run()).toBe(20)
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/deployments/10/')),
    ).toHaveLength(0)
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/deployments/20/')),
    ).toHaveLength(2)
  })

  test('does not trigger the branch hook for a superseded commit', async () => {
    const { run, fetcher } = harness({ stale: true })
    await expect(run()).rejects.toThrow(/superseded/i)
    expect(fetcher.mock.calls.some(([url]) => url === hook)).toBe(false)
  })

  test('stops waiting when main advances during a deployment', async () => {
    await expect(harness({ superseded: true }).run()).rejects.toThrow(/superseded/i)
  })

  test('retries a transient GitHub read without repeating the deploy hook', async () => {
    const { run, fetcher } = harness({ transient: true })
    expect(await run()).toBe(20)
    expect(fetcher.mock.calls.filter(([url]) => url === hook)).toHaveLength(1)
  })

  test('reports permanent API errors without triggering a deployment', async () => {
    const { run, fetcher } = harness({ denied: true })
    await expect(run()).rejects.toThrow(/403/)
    expect(fetcher.mock.calls.some(([url]) => url === hook)).toBe(false)
  })

  test('reports failure of the new build even when an older build succeeded', async () => {
    await expect(harness({ failed: true }).run()).rejects.toThrow(/deployment failed/i)
  })
})
