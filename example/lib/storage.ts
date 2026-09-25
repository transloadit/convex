import { album } from './album-access'

// Transloadit Storage is optional in the demo: without a Workspace, uploads keep the R2-only path.
export const getStorageWorkspace = () => process.env.TRANSLOADIT_WORKSPACE?.trim() || undefined

export const getStorageConfig = () => {
  const workspace = getStorageWorkspace()
  return workspace ? { workspace } : undefined
}

// Previews and production share one demo Workspace; the Convex deployment keeps their uploads and
// cleanup apart without another configuration value.
const deploymentSlug = () => {
  try {
    const host = new URL(process.env.CONVEX_CLOUD_URL ?? '').hostname
    return host.split('.')[0] || 'local'
  } catch {
    return 'local'
  }
}

/** Server-chosen, unguessable destination for one upload. Clients never choose Storage paths. */
export const getUploadStoragePrefix = (uploadId: string) =>
  `convex-demo/${deploymentSlug()}/${album}/${uploadId}/`

/** A stored file belongs to an upload only when it was written directly under its prefix. */
export const isInUploadStoragePrefix = (path: string, prefix: string) =>
  path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/')
