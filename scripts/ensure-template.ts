import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from './env.ts'

loadEnv()

const templateName = process.env.TRANSLOADIT_TEMPLATE_NAME ?? 'convex-demo'
const templateFile = resolve('templates/convex-demo.json')

if (!existsSync(templateFile)) {
  throw new Error(`Template file not found: ${templateFile}`)
}

const env = { ...process.env }

if (!env.TRANSLOADIT_KEY || !env.TRANSLOADIT_SECRET) {
  throw new Error('Missing TRANSLOADIT_KEY/TRANSLOADIT_SECRET')
}

function run(args: string[]) {
  const result = spawnSync('npx', ['--yes', 'transloadit', ...args], {
    env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim()
    throw new Error(message || 'Transloadit CLI failed')
  }
  return result.stdout.trim()
}

type TemplateRecord = {
  id?: string
  name?: string
  template_id?: string
}

function parseJsonLines(output: string): TemplateRecord[] {
  const trimmed = output.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed as TemplateRecord[]
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed as TemplateRecord]
    }
  } catch {
    // fall back to line-delimited JSON
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TemplateRecord)
}

const listOutput = run(['templates', 'list', '-j', '--fields', 'id,name'])
const templates = parseJsonLines(listOutput)
const existing = templates.find((template) => template.name === templateName)

let templateId = ''
if (existing?.id) {
  const modifyOutput = run(['templates', 'modify', '-j', existing.id, templateFile])
  const modifyPayloads = parseJsonLines(modifyOutput)
  const modifyPayload =
    modifyPayloads.length > 0 ? modifyPayloads[modifyPayloads.length - 1] : undefined
  templateId = modifyPayload?.id ?? existing.id
} else {
  const createOutput = run(['templates', 'create', '-j', templateName, templateFile])
  const createPayloads = parseJsonLines(createOutput)
  const createPayload =
    createPayloads.length > 0 ? createPayloads[createPayloads.length - 1] : undefined
  templateId = createPayload?.id ?? createPayload?.template_id ?? ''
}

if (!templateId) {
  throw new Error('Unable to determine template id from Transloadit CLI output')
}

console.log(
  JSON.stringify(
    {
      templateId,
      templateName,
    },
    null,
    2,
  ),
)
