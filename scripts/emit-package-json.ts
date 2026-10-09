import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const distDir = new URL('../dist/', import.meta.url)
mkdirSync(distDir, { recursive: true })

const { name, version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string }

const packageJson = {
  name,
  version,
  type: 'module',
  // This manifest defines the dist package scope, so its self import needs the version export too.
  exports: { './package.json': './package.json' },
}

writeFileSync(join(distDir.pathname, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
