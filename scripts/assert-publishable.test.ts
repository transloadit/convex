// @vitest-environment node
import { expect, test } from 'vitest'
import { unpublishableDependencies } from './assert-publishable.ts'

test('flags local runtime dependency specs but allows local development tools', () => {
  expect(
    unpublishableDependencies({
      dependencies: { '@transloadit/zod': 'file:./vendor/zod.tgz', convex: '^1.45.0' },
      peerDependencies: { react: '^19.0.0', local: 'link:../local' },
      devDependencies: { '@transloadit/viewer': 'file:./vendor/viewer.tgz' },
    }),
  ).toEqual([
    'dependencies.@transloadit/zod: file:./vendor/zod.tgz',
    'peerDependencies.local: link:../local',
  ])
  expect(unpublishableDependencies({ dependencies: { convex: '^1.45.0' } })).toEqual([])
})
