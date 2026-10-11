// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { checkPreviewBackend } from './preview-backend.ts'

const appUrl = 'https://convex-git-new-branch-transloadit-com.vercel.app'
const convexUrl = 'https://valuable-rabbit-413.convex.cloud'
const bypassToken = 'bypass-token-value'
const page = (body: string, status = 200) => new Response(body, { status })
const connected = `<script>self.__next_f.push([1,"{\\"convexUrl\\":\\"${convexUrl}\\"}"])</script>`
const unavailable =
  '<main class="page unavailable-message"><h1>Gallery temporarily unavailable</h1>'

const rejection = (promise: Promise<void>) =>
  promise.then(
    () => {
      throw new Error('expected the check to fail')
    },
    (error: Error) => error,
  )

const check = (responses: Array<Response | Error>, branch = 'new-branch') => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const next = responses.shift()
    if (!next || next instanceof Error) throw next ?? new Error('no response')
    return next
  })
  const promise = checkPreviewBackend({
    appUrl,
    convexUrl: `${convexUrl}/`,
    branch,
    bypassToken,
    fetcher,
    pause: async () => {},
  })
  return { fetcher, promise }
}

describe('checkPreviewBackend', () => {
  test('accepts a preview built with this branch’s Convex URL', async () => {
    const { fetcher, promise } = check([page(connected)])
    await expect(promise).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith(appUrl, expect.anything())
    const init = fetcher.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('x-vercel-protection-bypass')).toBe(bypassToken)
  })

  test('names the exact branch-scoped setup when the preview has no backend', async () => {
    const { promise } = check([page(unavailable)])
    const error = await rejection(promise)
    expect(error.message).toContain('shows the unavailable state')
    expect(error.message).toContain(
      `vercel env add NEXT_PUBLIC_CONVEX_URL preview --git-branch new-branch --value ${convexUrl} --no-sensitive --force --project convex --scope transloadit-com`,
    )
    expect(error.message).toContain('push a new commit')
    expect(error.message).not.toContain(bypassToken)
  })

  test('rejects a preview that talks to another Convex deployment', async () => {
    const other = connected.replace(convexUrl, 'https://little-aardvark-87.convex.cloud')
    const { promise } = check([page(other)])
    await expect(promise).rejects.toThrow('it uses https://little-aardvark-87.convex.cloud')
  })

  test('quotes a branch name that the shell would otherwise interpret', async () => {
    const { promise } = check([page(unavailable)], 'feat/a$b')
    await expect(promise).rejects.toThrow("--git-branch 'feat/a$b' --value")
  })

  test('retries transient failures and reports the last status without the bypass token', async () => {
    const recovered = check([page('', 503), new TypeError('reset'), page(connected)])
    await expect(recovered.promise).resolves.toBeUndefined()
    expect(recovered.fetcher).toHaveBeenCalledTimes(3)

    const { promise } = check([page('', 503), page('', 502), page('', 401)])
    const error = await rejection(promise)
    expect(error.message).toBe('Vercel preview did not load: HTTP 401')
  })

  test('retries when the body fails after the headers arrive', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('Connection reset while reading response'))
        },
      }),
    )
    const { fetcher, promise } = check([broken, page(connected)])
    await expect(promise).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  test('does not prescribe Vercel setup for an unrelated page', async () => {
    const { promise } = check([page('<html><title>Log in to Vercel</title></html>')])
    const error = await rejection(promise)
    expect(error.message).toContain(
      'neither embeds a Convex deployment nor shows the unavailable state',
    )
    expect(error.message).not.toContain('vercel env add')
  })

  test('refuses a backend URL that is not a Convex deployment', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(
      checkPreviewBackend({
        appUrl,
        convexUrl: 'https://example.invalid',
        branch: 'new-branch',
        bypassToken,
        fetcher,
      }),
    ).rejects.toThrow('not a Convex deployment URL')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
