import { config } from 'dotenv'

export const loadEnv = () => {
  config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true })
}

/** Production must retain its Workspace even during an upload pause, so delivery keeps working. */
export function getProductionDeployEnv(env: NodeJS.ProcessEnv = process.env): [string, string][] {
  if (!env.TRANSLOADIT_WORKSPACE?.trim())
    throw new Error('TRANSLOADIT_WORKSPACE is required for the hosted demo')
  return getOptionalDeployEnv(env)
}

/** Optional backend settings shared by production and isolated preview deployments. */
export function getOptionalDeployEnv(env: NodeJS.ProcessEnv = process.env): [string, string][] {
  const entries: [string, string][] = []
  for (const name of [
    'WEDDING_UPLOAD_CODE',
    'TRANSLOADIT_WORKSPACE',
    'TRANSLOADIT_STORAGE_UPLOADS_DISABLED',
    'TRANSLOADIT_WEDDING_TEMPLATE_ID',
  ]) {
    const value = env[name]
    // Explicitly empty switches must clear prior settings; absent optional credentials must not.
    if (
      value !== undefined &&
      (value !== '' ||
        name === 'TRANSLOADIT_WORKSPACE' ||
        name === 'TRANSLOADIT_STORAGE_UPLOADS_DISABLED' ||
        name === 'TRANSLOADIT_WEDDING_TEMPLATE_ID')
    ) {
      entries.push([name, value])
    }
  }
  return entries
}
