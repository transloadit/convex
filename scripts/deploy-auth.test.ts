// @vitest-environment node
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { parse } from 'dotenv'
import { beforeEach, expect, test, vi } from 'vitest'
import { ensureDeploymentAuth } from './deploy-auth.ts'

const spawnSync = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawnSync }))
const values = new Map<string, string>()
const options = { cwd: '/example', deploymentName: 'test-album', env: {} }

beforeEach(() => {
  values.clear()
  spawnSync.mockReset().mockImplementation((_command, args, call) => {
    const name = args.at(-1)
    if (args[2] === 'set') {
      for (const [key, value] of Object.entries(parse(call.input))) values.set(key, value)
    }
    return { status: 0, stdout: args[2] === 'get' ? (values.get(name) ?? '') : '', stderr: '' }
  })
})

test('preserves the signing key and existing-session signature across ordinary redeploys', () => {
  expect(ensureDeploymentAuth(options)).toBe('initialized')
  const privateKey = values.get('JWT_PRIVATE_KEY') ?? ''
  const signature = sign('RSA-SHA256', Buffer.from('existing guest session'), privateKey)
  const before = new Map(values)
  spawnSync.mockClear()
  expect(ensureDeploymentAuth(options)).toBe('preserved')
  expect(values).toEqual(before)
  expect(spawnSync.mock.calls.every(([, args]) => args[2] === 'get')).toBe(true)
  const { keys } = JSON.parse(values.get('JWKS') ?? '')
  expect(
    verify(
      'RSA-SHA256',
      Buffer.from('existing guest session'),
      createPublicKey({ key: keys[0], format: 'jwk' }),
      signature,
    ),
  ).toBe(true)
})

test.each(['JWT_PRIVATE_KEY', 'JWKS'])(
  'refuses an incomplete pair missing %s without overwriting',
  (missing) => {
    ensureDeploymentAuth(options)
    values.delete(missing)
    spawnSync.mockClear()
    expect(() => ensureDeploymentAuth(options)).toThrow('Incomplete deployment auth key pair')
    expect(spawnSync.mock.calls.every(([, args]) => args[2] === 'get')).toBe(true)
  },
)

test('refuses a mismatched public key and an implicit environment-key rotation', () => {
  ensureDeploymentAuth(options)
  const otherKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
  spawnSync.mockClear()
  expect(() => ensureDeploymentAuth({ ...options, initialPrivateKey: otherKey })).toThrow(
    'Explicit auth key rotation required',
  )
  expect(spawnSync.mock.calls.every(([, args]) => args[2] === 'get')).toBe(true)
  values.set(
    'JWKS',
    JSON.stringify({ keys: [createPublicKey(otherKey).export({ format: 'jwk' })] }),
  )
  expect(() => ensureDeploymentAuth(options)).toThrow('Invalid deployment auth key pair')
})

test('never prints a failed credential read or puts a key in process arguments', () => {
  ensureDeploymentAuth(options)
  expect(
    spawnSync.mock.calls.every(
      ([, args]) => !args.some((arg: string) => arg.includes('PRIVATE KEY')),
    ),
  ).toBe(true)
  expect(
    spawnSync.mock.calls
      .filter(([, args]) => args[2] === 'set')
      .every(([, , call]) => call.stdio === 'pipe' && typeof call.input === 'string'),
  ).toBe(true)
  spawnSync.mockReturnValue({ status: 1, stdout: 'secret sentinel', stderr: 'secret sentinel' })
  expect(() => ensureDeploymentAuth(options)).toThrow(
    /^Cannot read deployment auth variable JWT_PRIVATE_KEY$/,
  )
})

test('re-reads an ambiguous write outcome instead of retrying or rotating', () => {
  spawnSync.mockImplementation((_command, args, call) => {
    const name = args.at(-1)
    if (args[2] === 'set') {
      for (const [key, value] of Object.entries(parse(call.input))) values.set(key, value)
      return { status: 1, stdout: '', stderr: 'secret sentinel' }
    }
    return { status: 0, stdout: args[2] === 'get' ? (values.get(name) ?? '') : '', stderr: '' }
  })
  expect(() => ensureDeploymentAuth(options)).toThrow(/^Cannot write deployment auth key pair$/)
  expect(spawnSync.mock.calls.filter(([, args]) => args[2] === 'set')).toHaveLength(1)
  const before = new Map(values)
  spawnSync.mockClear()
  expect(ensureDeploymentAuth(options)).toBe('preserved')
  expect(values).toEqual(before)
  expect(spawnSync.mock.calls.every(([, args]) => args[2] === 'get')).toBe(true)
})

test.each(['JWT_PRIVATE_KEY', 'JWKS'])('refuses malformed %s without exposing it', (name) => {
  ensureDeploymentAuth(options)
  values.set(name, 'private malformed value')
  spawnSync.mockClear()
  expect(() => ensureDeploymentAuth(options)).toThrow(/^Invalid deployment auth key pair$/)
  expect(spawnSync.mock.calls.every(([, args]) => args[2] === 'get')).toBe(true)
})

test('does not initialize auth with a weak supplied key', () => {
  const weakKey = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
  expect(() => ensureDeploymentAuth({ ...options, initialPrivateKey: weakKey })).toThrow(
    /^Invalid deployment auth key pair$/,
  )
  expect(values.size).toBe(0)
})

test('preserves the single-line PEM format produced by Convex Auth setup', () => {
  ensureDeploymentAuth(options)
  values.set('JWT_PRIVATE_KEY', (values.get('JWT_PRIVATE_KEY') ?? '').replaceAll('\n', ' '))
  const before = new Map(values)
  spawnSync.mockClear()
  expect(ensureDeploymentAuth(options)).toBe('preserved')
  expect(values).toEqual(before)
  expect(spawnSync.mock.calls.every(([, args]) => args[2] === 'get')).toBe(true)
})

test('treats an empty optional seed as absent', () => {
  expect(ensureDeploymentAuth({ ...options, initialPrivateKey: '' })).toBe('initialized')
  expect(values.has('JWT_PRIVATE_KEY')).toBe(true)
})

test('initializes the complete pair with one non-forcing stdin batch', () => {
  ensureDeploymentAuth(options)
  const writes = spawnSync.mock.calls.filter(([, args]) => args[2] === 'set')
  expect(writes).toHaveLength(1)
  const [, args, call] = writes[0]
  expect(args).not.toContain('--force')
  expect(parse(call.input)).toEqual(Object.fromEntries(values))
})
