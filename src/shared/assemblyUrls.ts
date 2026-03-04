import {
  ASSEMBLY_STATUS_COMPLETED,
  ASSEMBLY_STATUS_UPLOADING,
  type AssemblyStatus,
  type AssemblyStatusResults,
  assemblyStatusSchema,
  getAssemblyStage,
  isAssemblyCompletedStatus,
  isAssemblyUploadingStatus,
  normalizeAssemblyUploadUrls,
  parseAssemblyUrls,
  type AssemblyStage as ZodAssemblyStage,
  type AssemblyUrls as ZodAssemblyUrls,
  type NormalizedAssemblyUrls as ZodNormalizedAssemblyUrls,
} from '@transloadit/zod/v3'

export type AssemblyUrls = ZodAssemblyUrls
export type NormalizedAssemblyUrls = ZodNormalizedAssemblyUrls
export type AssemblyStage = ZodAssemblyStage
export type TransloaditAssembly = AssemblyStatus
export {
  ASSEMBLY_STATUS_COMPLETED,
  ASSEMBLY_STATUS_UPLOADING,
  getAssemblyStage,
  isAssemblyCompletedStatus,
  isAssemblyUploadingStatus,
  normalizeAssemblyUploadUrls,
  parseAssemblyUrls,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const parseAssemblyStatus = (data: unknown): TransloaditAssembly | null => {
  const parsed = assemblyStatusSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

export const parseAssemblyFields = (data: unknown): Record<string, unknown> => {
  const status = parseAssemblyStatus(data)
  const fields = status?.fields
  return isRecord(fields) ? fields : {}
}

export const parseAssemblyResults = (data: unknown): AssemblyStatusResults => {
  const status = parseAssemblyStatus(data)
  const results = status?.results
  if (!isRecord(results)) return {}

  const output: AssemblyStatusResults = {}
  for (const [key, value] of Object.entries(results)) {
    if (Array.isArray(value)) {
      output[key] = value as AssemblyStatusResults[string]
    }
  }
  return output
}
