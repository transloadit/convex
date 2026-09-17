// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { test } from 'vitest'
import { writeAppFiles } from './app-template.ts'

test('includes every local dependency needed to bundle the example backend for preview deployment', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'convex-template-test-'))
  try {
    await writeAppFiles({ projectDir, tgzPath: '/unused-test-package.tgz' })
    const files = await readdir(join(projectDir, 'convex'))
    await build({
      entryPoints: files
        .filter((file) => !file.endsWith('.test.ts'))
        .map((file) => join(projectDir, 'convex', file)),
      bundle: true,
      write: false,
      outdir: join(projectDir, 'build'),
      format: 'esm',
      packages: 'external',
      external: ['./_generated/*'],
      logLevel: 'silent',
    })
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
})
