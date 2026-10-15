// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { expect, test } from 'vitest'

test('the wedding app resolves its exact published dependency instead of the repository', () => {
  expect(
    execFileSync(process.execPath, ['scripts/check-demo-package.ts'], { encoding: 'utf8' }),
  ).toContain('Wedding demo uses published @transloadit/convex@0.5.0')
})

test('the hosted backend bundles the installed component without a repository-source alias', async () => {
  const result = await build({
    entryPoints: ['example/convex/convex.config.ts', 'example/convex/media.ts'],
    bundle: true,
    write: false,
    outdir: 'unused-test-output',
    format: 'esm',
    platform: 'browser',
    conditions: ['@convex-dev/component-source'],
    metafile: true,
    logLevel: 'silent',
  })
  const paths = Object.keys(result.metafile.inputs)
  expect(paths.some((path) => path.includes('node_modules/@transloadit/convex/'))).toBe(true)
  expect(paths.some((path) => path.startsWith('src/'))).toBe(false)
})
