// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { getPackages } from '@manypkg/get-packages'
import { build } from 'esbuild'
import { expect, test } from 'vitest'

test('the wedding app resolves its exact published dependency instead of the repository', () => {
  const manifest = JSON.parse(readFileSync('example/package.json', 'utf8'))
  expect(
    execFileSync(process.execPath, ['scripts/check-demo-package.ts'], { encoding: 'utf8' }),
  ).toContain(
    `Wedding demo uses published @transloadit/convex@${manifest.dependencies['@transloadit/convex']}`,
  )
})

test('Changesets still discovers the root library as a releaseable package', async () => {
  // This is the discovery API Changesets uses before constructing its release plan.
  const { packages } = await getPackages(process.cwd())
  expect(
    packages.filter((pkg) => !pkg.packageJson.private).map((pkg) => pkg.packageJson.name),
  ).toEqual(['@transloadit/convex'])
  // A future library release must not move the demo to an unpublished registry version.
  const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
  expect(config.bumpVersionsWithWorkspaceProtocolOnly).toBe(true)
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
    external: ['./_generated/*'],
    metafile: true,
    logLevel: 'silent',
  })
  const paths = Object.keys(result.metafile.inputs)
  expect(paths.some((path) => path.includes('node_modules/@transloadit/convex/'))).toBe(true)
  expect(paths.some((path) => path.startsWith('src/'))).toBe(false)
})
