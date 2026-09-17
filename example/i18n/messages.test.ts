import { createTranslator } from 'next-intl'
import { expect, test } from 'vitest'
import { locales } from './locales'
import { messages } from './messages'

const flatten = (object: Record<string, unknown>, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof value === 'string'
        ? [[path, value]]
        : Object.entries(flatten(value as Record<string, unknown>, path))
    }),
  )

test.each(locales)('%s has a complete catalog with valid ICU messages', (locale) => {
  const catalog = flatten(messages[locale])
  expect(Object.keys(catalog).sort()).toEqual(Object.keys(flatten(messages.en)).sort())
  const errors: unknown[] = []
  for (const key of Object.keys(catalog)) {
    // Nested keys use namespaces; test a one-message catalog to format every message identically.
    const format = createTranslator({
      locale,
      messages: { message: catalog[key] },
      onError: (error) => errors.push(error),
    })
    expect(
      format.rich('message', {
        names: 'Eden & Nico',
        name: 'Олена',
        language: 'English',
        count: 3,
        hours: 24,
        current: 1,
        total: 3,
        id: 'assembly',
        status: 'ASSEMBLY_COMPLETED',
        transloadit: (text) => text,
        convex: (text) => text,
      }),
    ).toBeTruthy()
  }
  expect(errors).toEqual([])
})

test.each([
  [1, '1 файл'],
  [2, '2 файли'],
  [5, '5 файлів'],
  [21, '21 файл'],
] as const)('uses Ukrainian plural rules for %s uploaded files', (count, expected) => {
  const t = createTranslator({ locale: 'uk', messages: messages.uk })
  expect(t('upload.success', { count })).toContain(expected)
})
