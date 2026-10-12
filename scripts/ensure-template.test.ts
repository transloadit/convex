// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const { state, createTemplate, editTemplate, listTemplates } = vi.hoisted(() => ({
  state: { wedding: false },
  createTemplate: vi.fn(async () => ({ id: 'new-template' })),
  editTemplate: vi.fn(async () => ({ id: 'existing-template' })),
  listTemplates: vi.fn(async () => ({ items: [{ name: 'convex-demo', id: 'legacy-template' }] })),
}))
vi.mock('./env.ts', () => ({ loadEnv: () => {} }))
vi.mock('node:util', () => ({ parseArgs: () => ({ values: state }) }))
vi.mock('@transloadit/node', async (importOriginal) => {
  const original = await importOriginal<typeof import('@transloadit/node')>()
  return {
    ...original,
    Transloadit: class {
      createTemplate = createTemplate
      editTemplate = editTemplate
      listTemplates = listTemplates
    },
  }
})
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('TRANSLOADIT_KEY', 'test-key')
  vi.stubEnv('TRANSLOADIT_SECRET', 'test-secret')
  vi.stubEnv('TRANSLOADIT_TEMPLATE_NAME', 'convex-demo')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('wedding mode cannot overwrite the legacy demo Template via its name setting', async () => {
  state.wedding = true
  await import('./ensure-template.ts')
  await vi.waitFor(() =>
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'convex-wedding-media-v1',
        require_signature_auth: 1,
        template: expect.objectContaining({ allow_steps_override: true }),
      }),
    ),
  )
  expect(editTemplate).not.toHaveBeenCalled()
})

test('legacy mode preserves its Template settings', async () => {
  state.wedding = false
  await import('./ensure-template.ts')
  await vi.waitFor(() => expect(editTemplate).toHaveBeenCalledOnce())
  expect(editTemplate).toHaveBeenCalledWith('legacy-template', {
    name: 'convex-demo',
    template: { steps: expect.any(Object) },
  })
})
