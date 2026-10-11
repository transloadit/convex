export type PreviewBackendOptions = {
  appUrl: string
  convexUrl: string
  branch: string
  bypassToken: string
  fetcher?: typeof fetch
  pause?: () => Promise<void>
}

const convexHosts = /https:\/\/[a-z0-9-]+\.convex\.cloud/g

const trimSlash = (value: string) => value.replace(/\/+$/, '')
const shellWord = (value: string) =>
  /^[\w./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`

// The command a person with Vercel access runs once per branch. The value is the public URL
// Convex assigned to this branch's preview, never one derived from the branch name. --force
// replaces a stale value for this branch only.
export const setupCommand = (branch: string, convexUrl: string) =>
  `vercel env add NEXT_PUBLIC_CONVEX_URL preview --git-branch ${shellWord(branch)} --value ${convexUrl}` +
  ' --no-sensitive --force --project convex --scope transloadit-com'

// Vercel freezes NEXT_PUBLIC_CONVEX_URL into each build, and a new branch has none until someone
// scopes it. Fail before browser QA, naming the exact setup, instead of timing out at guest entry.
export const checkPreviewBackend = async ({
  appUrl,
  convexUrl,
  branch,
  bypassToken,
  fetcher = fetch,
  pause = () => new Promise((resolve) => setTimeout(resolve, 5000)),
}: PreviewBackendOptions) => {
  const expected = trimSlash(convexUrl)
  if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(expected)) {
    throw new Error('E2E_REMOTE_CONVEX_URL is not a Convex deployment URL')
  }
  let html: string | null = null
  for (let attempt = 0; attempt < 3 && html === null; attempt += 1) {
    let status = 'network error'
    try {
      // The bypass token stays in a header; error messages never include it.
      const response = await fetcher(appUrl, {
        headers: { 'x-vercel-protection-bypass': bypassToken },
        signal: AbortSignal.timeout(30_000),
      })
      status = `HTTP ${response.status}`
      // Read the body inside the retry: a reset after the headers is as transient as one before.
      if (response.ok) html = await response.text()
    } catch {
      status = 'network error'
    }
    if (html !== null) break
    if (attempt === 2) throw new Error(`Vercel preview did not load: ${status}`)
    await pause()
  }
  if (html === null) throw new Error('Vercel preview did not load')

  if (html.includes(expected)) return
  const found = [...new Set(html.match(convexHosts) ?? [])]
  if (!found.length && !html.includes('unavailable-message')) {
    // A login wall or interstitial is not a missing variable; do not prescribe a config change.
    throw new Error(
      `The Vercel preview for branch "${branch}" neither embeds a Convex deployment nor shows the unavailable state.`,
    )
  }
  const actual = found.length
    ? `it uses ${found.join(', ')}`
    : 'it has no NEXT_PUBLIC_CONVEX_URL and shows the unavailable state'
  throw new Error(
    [
      `The Vercel preview for branch "${branch}" is not connected to its Convex preview ${expected}: ${actual}.`,
      'Scope the variable to this branch once, then push a new commit so Vercel rebuilds the preview:',
      `  ${setupCommand(branch, expected)}`,
    ].join('\n'),
  )
}
