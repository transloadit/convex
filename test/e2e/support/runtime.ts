type Mode = 'local' | 'cloud'

export type RuntimeConfig = {
  authKey: string
  authSecret: string
  mode: Mode
  useRemote: boolean
  remoteAppUrl: string
  shouldRun: boolean
}

export const getRuntimeConfig = (): RuntimeConfig => {
  const authKey = process.env.TRANSLOADIT_KEY ?? ''
  const authSecret = process.env.TRANSLOADIT_SECRET ?? ''
  const modeEnv = process.env.E2E_MODE ?? 'local'
  const mode: Mode = modeEnv === 'cloud' ? 'cloud' : 'local'
  const useRemote = mode === 'cloud'
  const remoteAppUrl = process.env.E2E_REMOTE_APP_URL ?? process.env.E2E_APP_URL ?? ''
  const shouldRun = useRemote || Boolean(authKey && authSecret)
  return {
    authKey,
    authSecret,
    mode,
    useRemote,
    remoteAppUrl,
    shouldRun,
  }
}

export const runtime = getRuntimeConfig()
