import { spawnSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { z } from 'zod'

type AuthVariable = 'JWT_PRIVATE_KEY' | 'JWKS'
type Options = {
  cwd: string
  deploymentName: string
  env: NodeJS.ProcessEnv
  initialPrivateKey?: string
}

const publicKeys = z.object({
  keys: z.array(z.object({ kty: z.literal('RSA'), n: z.string(), e: z.string() })).min(1),
})

const signingKey = (privateKey: string) => {
  // Convex Auth's setup emits single-line PKCS8 PEM. Normalize only for Node's parser;
  // preserving a deployed pair must not rewrite its stored representation.
  const pem =
    /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END PRIVATE KEY-----$/.exec(
      privateKey.trim(),
    )
  const key = createPrivateKey(
    pem
      ? `-----BEGIN PRIVATE KEY-----\n${pem[1].replace(/\s/g, '')}\n-----END PRIVATE KEY-----\n`
      : privateKey,
  )
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error('Invalid deployment auth key pair')
  return key
}
const publicKey = (privateKey: string) =>
  createPublicKey(signingKey(privateKey)).export({ format: 'jwk' })

/** Keep ordinary deploys from invalidating existing guests; rotation is a separate operation. */
export function ensureDeploymentAuth(options: Options): 'preserved' | 'initialized' {
  const variable = (operation: 'get' | 'set', name?: AuthVariable, input?: string) => {
    // Never use the generic command logger here: failed CLI output can contain credentials.
    const result = spawnSync(
      'npx',
      [
        'convex',
        'env',
        operation,
        '--deployment-name',
        options.deploymentName,
        ...(name ? [name] : []),
      ],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        stdio: 'pipe',
        input,
        timeout: 120_000,
      },
    )
    if (result.error || result.signal || result.status !== 0)
      throw new Error(
        `Cannot ${operation === 'get' ? 'read' : 'write'} deployment auth ${name ? `variable ${name}` : 'key pair'}`,
      )
    return result.stdout.trim()
  }

  const existingPrivate = variable('get', 'JWT_PRIVATE_KEY')
  const existingPublic = variable('get', 'JWKS')
  if (Boolean(existingPrivate) !== Boolean(existingPublic))
    throw new Error('Incomplete deployment auth key pair; reconcile it before deploying')

  let privateKey: string
  let jwks: string
  try {
    if (existingPrivate) {
      const expected = publicKey(existingPrivate)
      const actual = publicKeys.parse(JSON.parse(existingPublic))
      if (!actual.keys.some((key) => key.n === expected.n && key.e === expected.e))
        throw new Error('Mismatched public key')
      if (options.initialPrivateKey) {
        const supplied = publicKey(options.initialPrivateKey)
        if (supplied.n !== expected.n || supplied.e !== expected.e)
          throw new Error('Explicit auth key rotation required')
      }
      return 'preserved'
    }
    privateKey =
      options.initialPrivateKey ||
      generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey
    const key = signingKey(privateKey)
    // Canonical PEM has no arbitrary trailing text to inject additional dotenv variables.
    privateKey = key.export({ type: 'pkcs8', format: 'pem' }).toString()
    jwks = JSON.stringify({
      keys: [{ use: 'sig', ...createPublicKey(key).export({ format: 'jwk' }) }],
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Explicit auth key rotation required')
      throw error
    // Crypto/JSON/schema errors must not print a private key or environment value.
    throw new Error('Invalid deployment auth key pair')
  }

  // The CLI sends both changes in one request and refuses conflicting existing values without
  // --force. On an ambiguous failure, the next invocation re-reads instead of blindly retrying.
  variable('set', undefined, `JWT_PRIVATE_KEY=${JSON.stringify(privateKey)}\nJWKS=${jwks}\n`)
  return 'initialized'
}
