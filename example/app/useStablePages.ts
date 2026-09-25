'use client'

import { useQueries } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import { useMemo, useRef, useState } from 'react'
import { freezeAndExtend, type PageRequest, type PageResult, pageArgs } from '../lib/stable-pages'

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
  // Keep a page's previous result while its re-subscription (with an end cursor) loads.
  const loaded = useRef(new Map<number, PageResult<T>>())
  const current = pages.map((_, index) => {
    const result = results[String(index)]
    if (result !== undefined && !(result instanceof Error)) {
      loaded.current.set(index, result as PageResult<T>)
    }
    return loaded.current.get(index)
  })
  const last = current[current.length - 1]
  return {
    items: current.flatMap((result) => result?.page ?? []),
    loadMore:
      last && !last.isDone
        ? () => setPages((previous) => freezeAndExtend(previous, last))
        : undefined,
  }
}
