import { loadEnv } from './env.ts'
import { requireEnv } from './qa/run.ts'
import { deployVercel } from './qa/vercel-deploy.ts'

loadEnv()

const deploymentId = await deployVercel({
  repository: requireEnv('GITHUB_REPOSITORY'),
  sha: requireEnv('GITHUB_SHA'),
  token: requireEnv('GITHUB_TOKEN'),
  hook: requireEnv('VERCEL_DEPLOY_HOOK'),
})
console.log('Current commit reached Vercel production in deployment ' + deploymentId)
