import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { sleep } from './sleep.js'
import { startTunnel } from './tunnel.js'

type ExampleAppOptions = {
  env: NodeJS.ProcessEnv
}

type ExampleApp = {
  url: string
  notifyUrl: string
  close: () => Promise<void>
}

const findOpenPort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Unable to determine a free port')
  }
  const port = address.port
  server.close()
  return port
}

const waitForReady = async (url: string, child: ReturnType<typeof spawn>, logs: string[]) => {
  const deadline = Date.now() + 240_000
  const onData = (chunk: Buffer) => {
    const text = chunk.toString()
    text
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        logs.push(line)
        if (logs.length > 200) logs.shift()
      })
  }

  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next example exited early (${child.exitCode}).\n${logs.join('\n')}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // ignore until ready
    }
    await sleep(500)
  }

  throw new Error(`Next example did not start in time.\n${logs.join('\n')}`)
}

const runCommand = async (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  label: string,
) => {
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs: string[] = []
  const onData = (chunk: Buffer) => {
    const text = chunk.toString()
    text
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        logs.push(line)
        if (logs.length > 200) logs.shift()
      })
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  const exitCode: number = await new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`${label} failed (${exitCode}).\n${logs.join('\n')}`)
  }
}

export const startExampleApp = async ({ env }: ExampleAppOptions): Promise<ExampleApp> => {
  const port = await findOpenPort()
  const tunnel = await startTunnel(port)
  const notifyUrl = tunnel.info.notifyUrl ?? `${tunnel.info.url}/transloadit/webhook`

  const nextEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    TRANSLOADIT_NOTIFY_URL: notifyUrl,
    ...env,
  }
  if (env.E2E_MODE === 'local') {
    nextEnv.NEXT_PUBLIC_CONVEX_URL = ''
    nextEnv.CONVEX_URL = ''
  }

  await runCommand('yarn', ['build'], nextEnv, 'Package build')

  const nextCli = resolve('node_modules/next/dist/bin/next')
  await runCommand('node', [nextCli, 'build', 'example', '--webpack'], nextEnv, 'Next build')
  const child = spawn(
    'node',
    [nextCli, 'start', 'example', '--hostname', '127.0.0.1', '--port', `${port}`],
    {
      env: nextEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const url = `http://127.0.0.1:${port}`
  const logs: string[] = []
  await waitForReady(url, child, logs)

  const close = async () => {
    if (child.exitCode === null) {
      child.kill()
      await new Promise((resolvePromise) => {
        const fallback = setTimeout(() => {
          child.kill('SIGKILL')
          resolvePromise(null)
        }, 3000)
        child.once('exit', () => {
          clearTimeout(fallback)
          resolvePromise(null)
        })
      })
    }

    if (tunnel.process.exitCode === null) {
      tunnel.process.kill()
      await new Promise((resolvePromise) => {
        const fallback = setTimeout(() => {
          tunnel.process.kill('SIGKILL')
          resolvePromise(null)
        }, 3000)
        tunnel.process.once('exit', () => {
          clearTimeout(fallback)
          resolvePromise(null)
        })
      })
    }
  }

  return { url, notifyUrl, close }
}
