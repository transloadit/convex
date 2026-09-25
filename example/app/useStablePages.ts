'use client'

import { useQueries } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  freezeAndExtend,
  type PageRequest,
  type PageResult,
  pageArgs,
  splitPage,
} from '../lib/stable-pages'

/**
 * Reactive cursor pagination for component queries, which cannot use Convex's journaled
 * `.paginate()`: loaded pages are frozen with an end cursor, so live inserts grow the right page
 * instead of shifting items into the next one.
 */
export const useStablePages = <T>(
  query: FunctionReference<
    'query',
    'public',
    { paginationOpts: ReturnType<typeof pageArgs>['paginationOpts'] },
    PageResult<T>
  >,
  numItems: number,
) => {
  const [pages, setPages] = useState<PageRequest[]>([{ cursor: null }])
  const requests = useMemo(
    () =>
      Object.fromEntries(
        pages.map((request, index) => [
          String(index),
          { query, args: pageArgs(request, numItems) },
        ]),
      ),
    [pages, query, numItems],
  )
  const results = useQueries(requests)
  // Keep a page's previous result while its re-subscription (with an end cursor) loads, but never
  // after it failed: a failed page is dropped and its error surfaced instead of stale photos.
  const loaded = useRef(new Map<number, PageResult<T>>())
  let error: Error | undefined
  const current = pages.map((_, index) => {
    const result = results[String(index)]
    if (result instanceof Error) {
      loaded.current.delete(index)
      error ??= result
      return undefined
    }
    if (result !== undefined) loaded.current.set(index, result as PageResult<T>)
    return loaded.current.get(index)
  })
  // A frozen page that outgrew the server limit is split, so no photo is skipped.
  const splitAt = current.findIndex(
    (result, index) => result?.splitCursor && pages[index]?.endCursor,
  )
  const splitCursor = splitAt >= 0 ? current[splitAt]?.splitCursor : undefined
  useEffect(() => {
    if (splitAt < 0 || !splitCursor) return
    loaded.current.clear()
    setPages((previous) => splitPage(previous, splitAt, splitCursor))
  }, [splitAt, splitCursor])
  const last = current[current.length - 1]
  return {
    items: current.flatMap((result) => result?.page ?? []),
    error,
    loadMore:
      !error && last && !last.isDone
        ? () => setPages((previous) => freezeAndExtend(previous, last))
        : undefined,
  }
}
