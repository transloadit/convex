// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { makeFunctionReference } from 'convex/server'
import { afterEach, expect, test, vi } from 'vitest'
import type { PageResult } from '../lib/stable-pages'

const results: Record<string, unknown> = {}
vi.mock('convex/react', () => ({ useQueries: () => ({ ...results }) }))
const { useStablePages } = await import('./useStablePages')

afterEach(() => {
  cleanup()
  for (const key of Object.keys(results)) delete results[key]
})

const query = makeFunctionReference<
  'query',
  { paginationOpts: { numItems: number; cursor: string | null; endCursor?: string } },
  PageResult<string>
>('media:list')

test('a failing page is dropped and surfaced instead of serving its stale cache', () => {
  results['0'] = { page: ['a', 'b'], isDone: false, continueCursor: 'c1' }
  const { result, rerender } = renderHook(() => useStablePages(query, 2))
  expect(result.current.items).toEqual(['a', 'b'])
  expect(result.current.error).toBeUndefined()

  results['0'] = new Error('ACCESS_REQUIRED')
  rerender()
  expect(result.current.items).toEqual([])
  expect(result.current.error?.message).toBe('ACCESS_REQUIRED')
  expect(result.current.loadMore).toBeUndefined()

  results['0'] = { page: ['a'], isDone: true, continueCursor: 'c1' }
  rerender()
  expect(result.current.items).toEqual(['a'])
  expect(result.current.error).toBeUndefined()
})
