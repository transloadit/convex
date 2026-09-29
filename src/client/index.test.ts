import { describe, expect, test } from 'vitest'
import { makeTransloaditAPI, type TransloaditComponent } from './index.ts'

// Registered functions carry their validators as JSON for deploys; the public type omits it.
const exportedArgs = (fn: unknown) =>
  JSON.parse((fn as { exportArgs(): string }).exportArgs()) as { value: Record<string, unknown> }

describe('makeTransloaditAPI', () => {
  test('album listings do not let callers choose Assembly fields to join', () => {
    const api = makeTransloaditAPI({} as TransloaditComponent)
    expect(Object.keys(exportedArgs(api.listAlbumResults).value).sort()).toEqual([
      'album',
      'createdAfter',
      'limit',
      'stepNames',
    ])
  })
})
