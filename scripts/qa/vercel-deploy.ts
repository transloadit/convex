type Deployment = { id: number; environment: string; sha: string }
type DeploymentStatus = { state: string }

export type DeployOptions = {
  repository: string
  sha: string
  token: string
  hook: string
  fetcher?: typeof fetch
  pause?: () => Promise<void>
  attempts?: number
}

export const deployVercel = async ({
  repository,
  sha,
  token,
  hook,
  fetcher = fetch,
  pause = () => new Promise((resolve) => setTimeout(resolve, 5000)),
  attempts = 72,
}: DeployOptions) => {
  const root = 'https://api.github.com/repos/' + repository
  const headers = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json' }
  const read = async <T>(path: string): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response
      try {
        response = await fetcher(root + path, { headers, signal: AbortSignal.timeout(15_000) })
      } catch {
        if (attempt === 2) throw new Error('GitHub deployment lookup failed after three attempts')
        await pause()
        continue
      }
      if (response.ok) return (await response.json()) as T
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await pause()
        continue
      }
      throw new Error('GitHub deployment lookup failed: HTTP ' + response.status)
    }
    throw new Error('GitHub deployment lookup failed')
  }
  const assertCurrent = async () => {
    const head = await read<{ object: { sha: string } }>('/git/ref/heads/main')
    if (head.object.sha !== sha) {
      throw new Error('Production deployment superseded: main no longer points to ' + sha)
    }
  }
  const listDeployments = () => read<Deployment[]>('/deployments?sha=' + sha)
  await assertCurrent()
  const existing = new Set((await listDeployments()).map((entry) => entry.id))
  // The existing deploy hook follows main. Refuse obsolete runs rather than silently verifying a
  // different revision. CI also cancels superseded runs; another push during polling fails promptly.
  await assertCurrent()
  const response = await fetcher(hook, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new Error('Vercel deploy hook request failed')
  })
  if (!response.ok) throw new Error('Vercel deploy hook failed: HTTP ' + response.status)

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertCurrent()
    const deployment = (await listDeployments()).find(
      (entry) =>
        !existing.has(entry.id) &&
        entry.sha === sha &&
        entry.environment.toLowerCase() === 'production',
    )
    if (deployment) {
      const statuses = await read<DeploymentStatus[]>('/deployments/' + deployment.id + '/statuses')
      if (statuses[0]?.state === 'success') return deployment.id
      if (['failure', 'error'].includes(statuses[0]?.state)) {
        throw new Error('Vercel production deployment failed')
      }
    }
    await pause()
  }
  throw new Error('Timed out waiting for Vercel production deployment')
}
