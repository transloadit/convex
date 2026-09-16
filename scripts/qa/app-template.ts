import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type WriteAppFilesOptions = {
  projectDir: string
  tgzPath: string
}

export const writeAppFiles = async ({ projectDir, tgzPath }: WriteAppFilesOptions) => {
  const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const dependencies: Record<string, string> = { '@transloadit/convex': `file:${tgzPath}` }
  for (const name of ['@auth/core', '@convex-dev/auth', '@transloadit/zod', 'convex', 'zod']) {
    dependencies[name] = manifest.dependencies[name] ?? manifest.devDependencies[name]
  }

  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify(
      { name: 'transloadit-convex-qa', private: true, type: 'module', dependencies },
      null,
      2,
    ),
  )

  // Deploy the actual example against the packed module. Maintaining a second backend here hid
  // drift in auth, signing, dependencies, and webhook handling from cloud verification.
  const convexFiles = (await readdir(join(repoRoot, 'example/convex'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `convex/${entry.name}`)
  for (const file of [
    ...convexFiles,
    'lib/r2.ts',
    'lib/transloadit-steps.ts',
    'lib/assembly-params.ts',
  ]) {
    await mkdir(join(projectDir, file, '..'), { recursive: true })
    await writeFile(join(projectDir, file), await readFile(join(repoRoot, 'example', file)))
  }
}
