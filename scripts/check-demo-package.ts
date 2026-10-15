import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { sep } from 'node:path'

const manifestUrl = new URL('../example/package.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'))
const require = createRequire(manifestUrl)
const packagePath = realpathSync(require.resolve('@transloadit/convex/package.json'))
const installed = JSON.parse(readFileSync(packagePath, 'utf8'))

// A matching workspace version is not release dogfooding. Resolve from the consuming app, then
// reject self-links so both the Vercel build and Convex deploy use the registry artifact.
assert(packagePath.includes(`${sep}node_modules${sep}`), 'Demo resolved the repository package')
assert.equal(installed.version, manifest.dependencies['@transloadit/convex'])
console.log(`Wedding demo uses published @transloadit/convex@${installed.version}`)
