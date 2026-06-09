import { setTimeout as sleep } from 'node:timers/promises'
import { loadEnv } from './env.ts'

loadEnv()

const deployHook = process.env.VERCEL_PREVIEW_DEPLOY_HOOK ?? ''
const vercelProject = process.env.VERCEL_PROJECT_SLUG ?? ''
const vercelTeam = process.env.VERCEL_TEAM_SLUG ?? ''
const vercelBypassToken = process.env.VERCEL_PROTECTION_BYPASS ?? ''
const githubToken = process.env.GITHUB_TOKEN ?? ''
const githubRepo = process.env.GITHUB_REPOSITORY ?? ''
const githubSha = process.env.GITHUB_SHA ?? ''
const githubEventPath = process.env.GITHUB_EVENT_PATH ?? ''
const githubHeadRef = process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? ''
const log = (...args: Parameters<typeof console.error>) => {
  console.error('[resolve-vercel-preview]', ...args)
}

if (!githubToken) {
  throw new Error('Missing GITHUB_TOKEN')
}
if (!githubRepo || !githubSha) {
  throw new Error('Missing GITHUB_REPOSITORY or GITHUB_SHA')
}

const apiBase = 'https://api.github.com'
const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${githubToken}`,
  'user-agent': 'convex-e2e-preview',
}

const triggerPreviewDeploy = async () => {
  if (!deployHook) return
  log('Triggering Vercel preview deploy hook')
  const response = await fetch(deployHook, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Vercel deploy hook failed: ${response.status}`)
  }
}

const fetchDeploymentUrl = async (): Promise<string | null> => {
  const deploymentsResponse = await fetch(
    `${apiBase}/repos/${githubRepo}/deployments?sha=${githubSha}`,
    { headers },
  )
  if (!deploymentsResponse.ok) {
    throw new Error(`Failed to list deployments: ${deploymentsResponse.status}`)
  }
  const deployments = (await deploymentsResponse.json()) as Array<{
    environment?: string
    statuses_url: string
  }>

  for (const deployment of deployments) {
    if (deployment.environment && deployment.environment.toLowerCase() !== 'preview') {
      continue
    }
    const statusesResponse = await fetch(deployment.statuses_url, { headers })
    if (!statusesResponse.ok) {
      continue
    }
    const statuses = (await statusesResponse.json()) as Array<{
      state?: string
      target_url?: string
    }>
    const success = statuses.find((status) => status.state === 'success')
    if (success?.target_url) {
      log('Found successful GitHub deployment URL')
      return success.target_url
    }
  }

  return null
}

const fetchCheckRunUrl = async (): Promise<string | null> => {
  const response = await fetch(`${apiBase}/repos/${githubRepo}/commits/${githubSha}/check-runs`, {
    headers,
  })
  if (!response.ok) {
    return null
  }
  const payload = (await response.json()) as {
    check_runs?: Array<{
      name?: string
      details_url?: string
      app?: { slug?: string }
      conclusion?: string | null
    }>
  }
  const checks = payload.check_runs ?? []
  const vercelCheck = checks.find(
    (check) => check.app?.slug === 'vercel' && check.conclusion === 'success' && check.details_url,
  )
  if (vercelCheck?.details_url) {
    log('Found successful Vercel check-run URL')
    return vercelCheck.details_url
  }
  return null
}

const fetchPreviewUrlFromComments = async (): Promise<string | null> => {
  if (!githubEventPath) return null
  try {
    const eventRaw = await import('node:fs').then((fs) => fs.readFileSync(githubEventPath, 'utf8'))
    const event = JSON.parse(eventRaw) as {
      pull_request?: { number?: number }
    }
    const prNumber = event.pull_request?.number
    if (!prNumber) return null

    const response = await fetch(`${apiBase}/repos/${githubRepo}/issues/${prNumber}/comments`, {
      headers,
    })
    if (!response.ok) return null
    const comments = (await response.json()) as Array<{
      user?: { login?: string }
      body?: string
    }>
    const vercelComment = comments.find((comment) => comment.user?.login === 'vercel[bot]')
    if (!vercelComment?.body) return null
    const match = vercelComment.body.match(/\[vc\]: #[^:]+:([A-Za-z0-9+/=]+)/)
    if (!match?.[1]) return null
    const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as {
      projects?: Array<{ previewUrl?: string }>
    }
    const previewUrl = payload.projects?.find((project) => project.previewUrl)?.previewUrl
    if (previewUrl) {
      log('Found Vercel preview URL in PR comments')
    }
    return previewUrl ?? null
  } catch {
    return null
  }
}

const normalizeUrl = (value: string): string => {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }
  return `https://${value}`
}

const slugifyBranch = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

const fallbackUrl =
  vercelProject && vercelTeam && githubHeadRef
    ? `https://${vercelProject}-git-${slugifyBranch(githubHeadRef)}-${vercelTeam}.vercel.app`
    : null

const isPreviewReady = async (url: string) => {
  try {
    const target = new URL(url)
    if (vercelBypassToken) {
      target.searchParams.set('__vercel_protection_bypass', vercelBypassToken)
    }
    const response = await fetch(target, {
      headers: vercelBypassToken ? { 'x-vercel-protection-bypass': vercelBypassToken } : undefined,
    })
    if (response.status === 404) return false
    if (response.status >= 500) return false
    return true
  } catch {
    return false
  }
}

await triggerPreviewDeploy()

const deadline = Date.now() + 6 * 60 * 1000
let attempts = 0
while (Date.now() < deadline) {
  attempts += 1
  const deploymentUrl = await fetchDeploymentUrl()
  if (deploymentUrl) {
    process.stdout.write(normalizeUrl(deploymentUrl))
    process.exit(0)
  }

  const checkUrl = await fetchCheckRunUrl()
  if (checkUrl) {
    process.stdout.write(normalizeUrl(checkUrl))
    process.exit(0)
  }

  const commentUrl = await fetchPreviewUrlFromComments()
  if (commentUrl) {
    process.stdout.write(normalizeUrl(commentUrl))
    process.exit(0)
  }

  if (fallbackUrl) {
    const ready = await isPreviewReady(fallbackUrl)
    if (ready) {
      log('Using ready fallback Vercel preview URL')
      process.stdout.write(normalizeUrl(fallbackUrl))
      process.exit(0)
    }
  }

  if (attempts === 1 || attempts % 6 === 0) {
    log(`Still waiting for preview URL after ${attempts} checks`)
  }

  await sleep(5000)
}

throw new Error('Timed out waiting for preview deployment URL')
