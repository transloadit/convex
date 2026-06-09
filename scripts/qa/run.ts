import { spawnSync } from 'node:child_process'

export type RunOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: 'inherit' | 'pipe'
  input?: string
  timeoutMs?: number
}

export const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} environment variable`)
  }
  return value
}

export const run = (command: string, args: string[], options: RunOptions = {}) => {
  const stdio = options.input !== undefined ? 'pipe' : (options.stdio ?? 'inherit')
  if (options.timeoutMs) {
    console.error(
      `Running with timeout (${Math.round(options.timeoutMs / 1000)}s): ${command} ${args.join(
        ' ',
      )}`,
    )
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    killSignal: 'SIGTERM',
  })

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  if (result.error) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}
${result.error.message}
${output}`)
  }

  if (result.signal) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}
Exited via signal ${result.signal}${options.timeoutMs ? ` after ${options.timeoutMs}ms` : ''}
${output}`)
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${output}`)
  }

  return output
}

export const parseJson = <T>(output: string): T => {
  const trimmed = output.trim()
  if (!trimmed) {
    throw new Error('Template preflight returned empty output')
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as T
  }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`Unable to parse JSON from output: ${trimmed}`)
  }
  return JSON.parse(trimmed.slice(first, last + 1)) as T
}

export const parseDeployOutput = (output: string) => {
  const cloudMatch = /https:\/\/([a-z0-9-]+)\.convex\.cloud/i.exec(output)
  if (cloudMatch?.[1]) {
    return {
      deploymentName: cloudMatch[1],
      deploymentUrl: `https://${cloudMatch[1]}.convex.cloud`,
    }
  }

  const siteMatch = /https:\/\/([a-z0-9-]+)\.convex\.site/i.exec(output)
  if (siteMatch?.[1]) {
    return {
      deploymentName: siteMatch[1],
      deploymentUrl: `https://${siteMatch[1]}.convex.cloud`,
    }
  }

  throw new Error(`Unable to find deployment URL in output:\n${output}`)
}
