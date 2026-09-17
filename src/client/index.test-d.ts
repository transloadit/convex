import { expectTypeOf, test } from 'vitest'
import type { TransloaditClient } from './index.ts'

test('metadata fields accept objects and reject primitive payloads', () => {
  type Fields = Parameters<TransloaditClient['storeAssemblyMetadata']>[1]['fields']
  expectTypeOf<{ album: string; guest: { name: string } }>().toExtend<Fields>()
  expectTypeOf<undefined>().toExtend<Fields>()
  expectTypeOf<string>().not.toExtend<Fields>()
  expectTypeOf<null>().not.toExtend<Fields>()
})
