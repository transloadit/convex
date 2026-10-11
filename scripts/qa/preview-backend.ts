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
// Convex assigned to this branch's preview, never one derived from the branch name.
export const setupCommand = (branch: string, convexUrl: string) =>
  `vercel env add NEXT_PUBLIC_CONVEX_URL preview --git-branch ${shellWord(branch)} --value ${convexUrl}` +
  ' --no-sensitive --project convex --scope transloadit-com'

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
  let html = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response | null = null
    try {
      // The bypass token stays in a header; error messages never include it.
      response = await fetcher(appUrl, {
        headers: { 'x-vercel-protection-bypass': bypassToken },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      response = null
    }
    if (response?.ok) {
      html = await response.text()
      break
    }
    if (attempt === 2) {
      throw new Error(
        `Vercel preview did not load: ${response ? `HTTP ${response.status}` : 'network error'}`,
      )
    }
    await pause()
  }

  if (html.includes(expected)) return
  const found = [...new Set(html.match(convexHosts) ?? [])]
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
