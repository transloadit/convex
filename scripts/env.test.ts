// @vitest-environment node
import { expect, test } from 'vitest'
import { getOptionalDeployEnv } from './env.ts'

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

test('optional credentials are not erased when absent and unrelated secrets are not forwarded', () => {
  expect(
    getOptionalDeployEnv({
      TRANSLOADIT_WORKSPACE: 'demo',
      R2_BUCKET: 'video',
      R2_SECRET_ACCESS_KEY: '',
      UNRELATED_SECRET: 'not-forwarded',
    }),
  ).toEqual([
    ['R2_BUCKET', 'video'],
    ['TRANSLOADIT_WORKSPACE', 'demo'],
  ])
})
