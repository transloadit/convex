import type { AssemblyStatus } from '@transloadit/zod/v3/assemblyStatus'
import { type StoredAsset, storedAssetSchema } from '@transloadit/zod/v3/storageAsset'
import { transloaditError } from './errors.ts'

export type { StoredAsset }

/** One canonical Storage receipt with the Assembly result that produced it. */
export type StoredAssemblyAsset = {
  asset: StoredAsset
  assemblyId: string
  stepName: string
  resultId: string
  originalId?: string | (string | null)[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isOriginalId = (value: unknown): value is StoredAssemblyAsset['originalId'] =>
  typeof value === 'string' ||
  (Array.isArray(value) && value.every((item) => item === null || typeof item === 'string'))

/**
 * Selects the Storage receipts of one completed Assembly, mirroring the Node SDK's
 * `getStoredAssemblyResults`: ordinary temporary results are skipped, while a partial, malformed or
 * cross-Workspace Storage record fails the whole batch instead of silently disappearing.
 * This verifies metadata only. Callers still bind the Assembly to their own server-created upload.
 */
export const selectStoredAssets = (
  payload: AssemblyStatus,
  { workspace }: { workspace: string },
): StoredAssemblyAsset[] => {
  const assemblyId = typeof payload.assembly_id === 'string' ? payload.assembly_id : ''
  if (!assemblyId) throw transloaditError('storage', 'Assembly is missing assembly_id')
  if (typeof payload.error === 'string') {
    throw transloaditError('storage', `Assembly failed with ${payload.error}`)
  }
  if (payload.ok !== 'ASSEMBLY_COMPLETED') {
    throw transloaditError('storage', `Assembly is not complete (${String(payload.ok)})`)
  }
  if (!isRecord(payload.results)) {
    throw transloaditError('storage', 'Completed Assembly did not contain results')
  }

  const selected: StoredAssemblyAsset[] = []
  for (const [stepName, files] of Object.entries(payload.results)) {
    if (!Array.isArray(files)) continue
    for (const file of files) {
      if (!isRecord(file)) continue
      if (
        file.asset_id === undefined &&
        file.version_id === undefined &&
        file.workspace === undefined
      )
        continue
      const parsed = storedAssetSchema.safeParse(file)
      if (
        !parsed.success ||
        parsed.data.workspace !== workspace ||
        typeof file.id !== 'string' ||
        file.id === '' ||
        (file.original_id !== undefined && !isOriginalId(file.original_id))
      ) {
        throw transloaditError(
          'storage',
          `Assembly ${assemblyId} returned an invalid or cross-Workspace Storage result in ${stepName}`,
        )
      }
      selected.push({
        asset: parsed.data,
        assemblyId,
        stepName,
        resultId: file.id,
        ...(file.original_id === undefined ? {} : { originalId: file.original_id }),
      })
    }
  }
  return selected
}
