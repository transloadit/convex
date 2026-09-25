import { readFileSync } from 'node:fs'

// A release must never publish a manifest whose runtime dependencies point at local files, such
// as vendored prerelease tarballs: consumers could not install it.
const localSpec = /^(file|link|portal|workspace|exec|patch):/

type Manifest = Record<string, unknown>

export const unpublishableDependencies = (manifest: Manifest) =>
  ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
    Object.entries((manifest[field] ?? {}) as Record<string, string>)
      .filter(([, spec]) => localSpec.test(spec))
      .map(([name, spec]) => `${field}.${name}: ${spec}`),
  )

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const problems = unpublishableDependencies(manifest)
  if (problems.length > 0) {
    console.error(`Refusing to release with local dependency specs:\n${problems.join('\n')}`)
    process.exit(1)
  }
}
