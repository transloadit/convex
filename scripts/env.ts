import { config } from 'dotenv'

export const loadEnv = () => {
  config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true })
}

/** Optional backend settings shared by production and isolated preview deployments. */
export function getOptionalDeployEnv(env: NodeJS.ProcessEnv = process.env): [string, string][] {
  const entries: [string, string][] = []
  for (const name of [
    'TRANSLOADIT_R2_CREDENTIALS',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'R2_HOST',
    'R2_PUBLIC_URL',
    'WEDDING_UPLOAD_CODE',
    'TRANSLOADIT_WORKSPACE',
    'TRANSLOADIT_STORAGE_UPLOADS_DISABLED',
  ]) {
    const value = env[name]
    // CI passes an empty Workspace on rollback. Skipping it would retain the previous enablement.
    if (
      value !== undefined &&
      (value !== '' ||
        name === 'TRANSLOADIT_WORKSPACE' ||
        name === 'TRANSLOADIT_STORAGE_UPLOADS_DISABLED')
    ) {
      entries.push([name, value])
    }
  }
  return entries
}
