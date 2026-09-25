/** One page of a cursor-paginated query; `endCursor` fixes its range once it has loaded. */
export type PageRequest = { cursor: string | null; endCursor?: string }

export type PageResult<T> = { page: T[]; isDone: boolean; continueCursor: string }

/**
 * Freezes the last loaded page at its continue cursor and requests the next one. A frozen page
 * keeps its range while new items arrive, so nothing shifts between pages or appears twice.
 */
export const freezeAndExtend = (
  pages: PageRequest[],
  last: Pick<PageResult<unknown>, 'continueCursor'>,
): PageRequest[] => {
  const current = pages[pages.length - 1]
  if (!current) return [{ cursor: null }]
  return [
    ...pages.slice(0, -1),
    { ...current, endCursor: last.continueCursor },
    { cursor: last.continueCursor },
  ]
}

export const pageArgs = (request: PageRequest, numItems: number) => ({
  paginationOpts: {
    numItems,
    cursor: request.cursor,
    ...(request.endCursor ? { endCursor: request.endCursor } : {}),
  },
})
