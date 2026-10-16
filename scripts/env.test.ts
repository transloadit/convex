// @vitest-environment node
import { expect, test } from 'vitest'
import { getOptionalDeployEnv, getProductionDeployEnv } from './env.ts'

test('production refuses missing Storage before any deployment, including when uploads are paused', () => {
  expect(() => getProductionDeployEnv({})).toThrow('TRANSLOADIT_WORKSPACE')
  expect(() => getProductionDeployEnv({ TRANSLOADIT_STORAGE_UPLOADS_DISABLED: '1' })).toThrow(
    'TRANSLOADIT_WORKSPACE',
  )
  expect(
    getProductionDeployEnv({
      TRANSLOADIT_WORKSPACE: 'album',
      TRANSLOADIT_STORAGE_UPLOADS_DISABLED: '1',
    }),
  ).toEqual([
    ['TRANSLOADIT_WORKSPACE', 'album'],
    ['TRANSLOADIT_STORAGE_UPLOADS_DISABLED', '1'],
  ])
})

test('an explicitly empty Workspace disables Storage on an existing deployment', () => {
  expect(getOptionalDeployEnv({ TRANSLOADIT_WORKSPACE: '' })).toEqual([
    ['TRANSLOADIT_WORKSPACE', ''],
  ])
})

test('local deployments without a Workspace setting leave the existing setting untouched', () => {
  expect(getOptionalDeployEnv({})).toEqual([])
})

test('an empty upload rollback switch restores Storage uploads', () => {
  expect(getOptionalDeployEnv({ TRANSLOADIT_STORAGE_UPLOADS_DISABLED: '' })).toEqual([
    ['TRANSLOADIT_STORAGE_UPLOADS_DISABLED', ''],
  ])
})

test('an explicitly empty Template ID restores the inline processing recipe', () => {
  expect(getOptionalDeployEnv({ TRANSLOADIT_WEDDING_TEMPLATE_ID: '' })).toEqual([
    ['TRANSLOADIT_WEDDING_TEMPLATE_ID', ''],
  ])
})

test('optional credentials are not erased when absent and unrelated secrets are not forwarded', () => {
  expect(
    getOptionalDeployEnv({
      TRANSLOADIT_WORKSPACE: 'demo',
      TRANSLOADIT_SECRET: '',
      UNRELATED_SECRET: 'not-forwarded',
    }),
  ).toEqual([['TRANSLOADIT_WORKSPACE', 'demo']])
})
