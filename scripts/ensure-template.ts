import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { assemblyInstructionsSchema, Transloadit } from '@transloadit/node'
import { weddingProcessingSteps } from '../example/lib/transloadit-steps.ts'
import { loadEnv } from './env.ts'

async function main() {
  loadEnv()
  const { values } = parseArgs({ options: { wedding: { type: 'boolean', default: false } } })
  const { TRANSLOADIT_KEY: authKey, TRANSLOADIT_SECRET: authSecret } = process.env
  if (!authKey || !authSecret) throw new Error('Missing TRANSLOADIT_KEY/TRANSLOADIT_SECRET')
  const client = new Transloadit({ authKey, authSecret })
  const name = values.wedding
    ? 'convex-wedding-media-v1'
    : (process.env.TRANSLOADIT_TEMPLATE_NAME ?? 'convex-demo')
  const template = assemblyInstructionsSchema.parse({
    steps: values.wedding
      ? weddingProcessingSteps
      : JSON.parse(
          await readFile(new URL('../templates/convex-demo.json', import.meta.url), 'utf8'),
        ),
    // The signing server adds literal, per-upload Storage paths; no field controls a destination.
    ...(values.wedding ? { allow_steps_override: true } : {}),
  })
  let existing: string | undefined
  for (let page = 1; ; page += 1) {
    const list = await client.listTemplates({ page, pagesize: 100, include_builtin: 'all' })
    existing = list.items.find((item) => item.name === name)?.id
    if (existing || list.items.length < 100) break
  }
  const params = { name, template, ...(values.wedding ? { require_signature_auth: 1 } : {}) }
  const result = existing
    ? await client.editTemplate(existing, params)
    : await client.createTemplate(params)
  console.log(JSON.stringify({ templateId: result.id, templateName: name }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
