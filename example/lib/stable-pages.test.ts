import { expect, test } from 'vitest'
import { freezeAndExtend, pageArgs } from './stable-pages'

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
