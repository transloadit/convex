import { expectTypeOf, test } from 'vitest'
import type { StoredMediaResponse, TransloaditClient } from './index.ts'

test('metadata fields accept objects and reject primitive payloads', () => {
  type Fields = Parameters<TransloaditClient['storeAssemblyMetadata']>[1]['fields']
  expectTypeOf<{ album: string; guest: { name: string } }>().toExtend<Fields>()
  expectTypeOf<undefined>().toExtend<Fields>()
  expectTypeOf<string>().not.toExtend<Fields>()
  expectTypeOf<null>().not.toExtend<Fields>()
})

test('deletion listings accept an omitted album, like the other ledger calls', () => {
  type Listing = Parameters<TransloaditClient['listStoredAssetDeletions']>[1]
  type Request = Parameters<TransloaditClient['requestStoredAssetDeletion']>[1]
  expectTypeOf<Omit<Listing, 'album'>>().toExtend<Listing>()
  expectTypeOf<Listing['album']>().toEqualTypeOf<Request['album']>()
})

test('exact grouped media uses the configured Workspace and requires a version and producer map', () => {
  type Lookup = Parameters<TransloaditClient['getStoredMedia']>[1]
  expectTypeOf<Omit<Lookup, 'workspace'>>().toExtend<Lookup>()
  expectTypeOf<Omit<Lookup, 'versionId'>>().not.toExtend<Lookup>()
  expectTypeOf<Omit<Lookup, 'originalSteps'>>().not.toExtend<Lookup>()
  expectTypeOf<ReturnType<TransloaditClient['getStoredMedia']>>().toEqualTypeOf<
    Promise<StoredMediaResponse | null>
  >()
  type Listing = Parameters<TransloaditClient['listStoredMedia']>[1]
  expectTypeOf<Listing['createdAfter']>().toEqualTypeOf<number | undefined>()
})
