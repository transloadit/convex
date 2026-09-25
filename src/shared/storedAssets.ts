import type { AssemblyStatus } from '@transloadit/zod/v3/assemblyStatus'
import type { StoredAsset } from '@transloadit/zod/v3/storageAsset'
import { extractStoredAssemblyResults } from '@transloadit/zod/v3/storageResults'
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

/**
 * Selects the Storage receipts of one completed Assembly with the shared extractor that the Node
 * SDK also uses: ordinary temporary results are skipped, while a partial, malformed or
 * cross-Workspace Storage record fails the whole batch instead of silently disappearing.
 * This verifies metadata only. Callers still bind the Assembly to their own server-created upload.
 */
export const selectStoredAssets = (
  payload: AssemblyStatus,
  { workspace }: { workspace: string },
): StoredAssemblyAsset[] => {
  const assemblyId = typeof payload.assembly_id === 'string' ? payload.assembly_id : ''
  if (!assemblyId) throw transloaditError('storage', 'Assembly is missing assembly_id')
  try {
    return extractStoredAssemblyResults(payload, { assemblyId, workspace }).map((result) => ({
      asset: result.asset,
      assemblyId: result.assembly_id,
      stepName: result.step,
      resultId: result.result_id,
      ...(result.original_id === undefined ? {} : { originalId: result.original_id }),
    }))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw transloaditError('storage', `${reason} (Assembly ${assemblyId})`)
  }
}
