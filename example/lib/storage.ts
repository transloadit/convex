import { album } from './album-access'

// Storage namespaces separate deployments that share one Workspace. A Convex cloud deployment
// name is unique; local and self-hosted deployments (for example every developer's 127.0.0.1)
// are not, so they must name their own namespace before writing to or cleaning up Storage.
const namespacePattern = /^[a-z0-9][a-z0-9-]{0,62}$/

const storageNamespace = () => {
  const explicit = process.env.TRANSLOADIT_STORAGE_NAMESPACE?.trim()
  if (explicit) return namespacePattern.test(explicit) ? explicit : undefined
  try {
    const host = new URL(process.env.CONVEX_CLOUD_URL ?? '').hostname
    return host.endsWith('.convex.cloud') ? host.split('.')[0] : undefined
  } catch {
    return undefined
  }
}

// Transloadit Storage is optional in the demo: without a Workspace and an unambiguous namespace,
// uploads keep the R2-only pipeline.
export const getStorageWorkspace = () => {
  const workspace = process.env.TRANSLOADIT_WORKSPACE?.trim()
  return workspace && storageNamespace() ? workspace : undefined
}

export const getStorageConfig = () => {
  const workspace = getStorageWorkspace()
  return workspace ? { workspace } : undefined
}

/** Everything this deployment's demo stores for one album; cleanup never leaves this prefix. */
export const getAlbumStoragePrefix = (albumName: string) => {
  const namespace = storageNamespace()
  return namespace ? `convex-demo/${namespace}/${albumName}/` : undefined
}

/** Server-chosen, unguessable destination for one upload. Clients never choose Storage paths. */
export const getUploadStoragePrefix = (uploadId: string) => {
  const albumPrefix = getAlbumStoragePrefix(album)
  if (!albumPrefix) throw new Error('Storage needs an unambiguous deployment namespace')
  return `${albumPrefix}${uploadId}/`
}

/** A stored file belongs to an upload only when it was written directly under its prefix. */
export const isInUploadStoragePrefix = (path: string, prefix: string) =>
  path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/')
