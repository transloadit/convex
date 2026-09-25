import { expect, test } from 'vitest'
import { freezeAndExtend, pageArgs, splitPage } from './stable-pages'

test('loading more freezes the last page and continues after it', () => {
  const first = [{ cursor: null }]
  const second = freezeAndExtend(first, { continueCursor: 'c1' })
  expect(second).toEqual([{ cursor: null, endCursor: 'c1' }, { cursor: 'c1' }])
  expect(freezeAndExtend(second, { continueCursor: 'c2' })).toEqual([
    { cursor: null, endCursor: 'c1' },
    { cursor: 'c1', endCursor: 'c2' },
    { cursor: 'c2' },
  ])
})

test('page arguments pass the end cursor only for frozen pages', () => {
  expect(pageArgs({ cursor: null }, 24)).toEqual({ paginationOpts: { numItems: 24, cursor: null } })
  expect(pageArgs({ cursor: 'c1', endCursor: 'c2' }, 24)).toEqual({
    paginationOpts: { numItems: 24, cursor: 'c1', endCursor: 'c2' },
  })
})

test('an overflowing frozen page splits into two contiguous frozen pages', () => {
  const pages = [{ cursor: null, endCursor: 'c1' }, { cursor: 'c1' }]
  expect(splitPage(pages, 0, 's')).toEqual([
    { cursor: null, endCursor: 's' },
    { cursor: 's', endCursor: 'c1' },
    { cursor: 'c1' },
  ])
  // An unfrozen page has nothing to split.
  expect(splitPage(pages, 1, 's')).toBe(pages)
})
