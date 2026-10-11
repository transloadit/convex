import { appendFileSync } from 'node:fs'
import { loadEnv } from './env.ts'
import { checkPreviewBackend } from './qa/preview-backend.ts'
import { requireEnv } from './qa/run.ts'

loadEnv()

try {
  await checkPreviewBackend({
    appUrl: requireEnv('E2E_REMOTE_APP_URL'),
    convexUrl: requireEnv('E2E_REMOTE_CONVEX_URL'),
    branch: process.env.GITHUB_HEAD_REF || requireEnv('GITHUB_REF_NAME'),
    bypassToken: requireEnv('VERCEL_PROTECTION_BYPASS'),
  })
  console.log('Vercel preview uses this branch’s Convex preview')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) appendFileSync(summary, `### Branch preview setup\n\n\`\`\`\n${message}\n\`\`\`\n`)
  console.error(message)
  process.exit(1)
}
