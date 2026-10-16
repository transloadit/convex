export const runtime = {
  remoteAppUrl: process.env.E2E_REMOTE_APP_URL ?? '',
  shouldRun: process.env.E2E_MODE === 'cloud',
}
