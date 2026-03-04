import { createHmac } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
  buildTransloaditParams,
  buildWebhookQueueArgs,
  handleWebhookRequest,
  parseAndVerifyTransloaditWebhook,
  parseTransloaditWebhook,
  signTransloaditParams,
  verifyWebhookSignature,
} from './apiUtils.ts'

describe('apiUtils', () => {
  test('buildTransloaditParams requires templateId or steps', () => {
    expect(() =>
      buildTransloaditParams({
        authKey: 'key',
      }),
    ).toThrow('Provide either templateId or steps')
  })

  test('signTransloaditParams uses sha384', async () => {
    const { paramsString } = buildTransloaditParams({
      authKey: 'key',
      templateId: 'tmpl_123',
      notifyUrl: 'https://example.com/webhook',
    })

    const signature = await signTransloaditParams(paramsString, 'secret')
    expect(signature.startsWith('sha384:')).toBe(true)

    const expected = createHmac('sha384', 'secret').update(paramsString).digest('hex')
    expect(signature).toBe(`sha384:${expected}`)
  })

  test('verifyWebhookSignature supports sha1 fallback', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const secret = 'webhook-secret'
    const digest = createHmac('sha1', secret).update(rawBody).digest('hex')

    const verified = await verifyWebhookSignature({
      rawBody,
      signatureHeader: `sha1:${digest}`,
      authSecret: secret,
    })

    expect(verified).toBe(true)
  })

  test('parseTransloaditWebhook returns payload and signature', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const formData = new FormData()
    formData.append('transloadit', JSON.stringify(payload))
    formData.append('signature', 'sha384:abc')

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })

    const result = await parseTransloaditWebhook(request)
    expect(result.payload).toEqual(payload)
    expect(result.rawBody).toBe(JSON.stringify(payload))
    expect(result.signature).toBe('sha384:abc')
  })

  test('parseTransloaditWebhook throws on missing payload', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: new FormData(),
    })

    await expect(parseTransloaditWebhook(request)).rejects.toThrow('Missing transloadit payload')
  })

  test('parseAndVerifyTransloaditWebhook verifies signature', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const secret = 'webhook-secret'
    const digest = createHmac('sha384', secret).update(rawBody).digest('hex')
    const formData = new FormData()
    formData.append('transloadit', rawBody)
    formData.append('signature', `sha384:${digest}`)

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })

    const parsed = await parseAndVerifyTransloaditWebhook(request, {
      authSecret: secret,
    })

    expect(parsed.payload).toEqual(payload)
    expect(parsed.verified).toBe(true)
  })

  test('parseAndVerifyTransloaditWebhook rejects invalid signature', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const formData = new FormData()
    formData.append('transloadit', JSON.stringify(payload))
    formData.append('signature', 'sha384:bad')

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })

    await expect(
      parseAndVerifyTransloaditWebhook(request, {
        authSecret: 'secret',
      }),
    ).rejects.toThrow('Invalid Transloadit webhook signature')
  })

  test('buildWebhookQueueArgs returns webhook payload args', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const secret = 'webhook-secret'
    const digest = createHmac('sha384', secret).update(rawBody).digest('hex')
    const formData = new FormData()
    formData.append('transloadit', rawBody)
    formData.append('signature', `sha384:${digest}`)

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })

    const args = await buildWebhookQueueArgs(request, { authSecret: secret })
    expect(args.payload).toEqual(payload)
    expect(args.rawBody).toBe(rawBody)
    expect(args.signature).toBe(`sha384:${digest}`)
  })

  test('buildWebhookQueueArgs can skip verification', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const formData = new FormData()
    formData.append('transloadit', rawBody)

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })

    const args = await buildWebhookQueueArgs(request, {
      authSecret: 'secret',
      requireSignature: false,
    })
    expect(args.payload).toEqual(payload)
    expect(args.rawBody).toBe(rawBody)
    expect(args.signature).toBeUndefined()
  })

  test('handleWebhookRequest queues webhook by default', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const formData = new FormData()
    formData.append('transloadit', rawBody)
    formData.append('signature', 'sha384:abc')

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })
    const runAction = vi.fn().mockResolvedValue(null)

    const response = await handleWebhookRequest(request, {
      runAction,
    })

    expect(runAction).toHaveBeenCalledWith({
      payload,
      rawBody,
      signature: 'sha384:abc',
    })
    expect(response.status).toBe(202)
  })

  test('handleWebhookRequest supports sync mode with verification', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const secret = 'webhook-secret'
    const digest = createHmac('sha384', secret).update(rawBody).digest('hex')
    const formData = new FormData()
    formData.append('transloadit', rawBody)
    formData.append('signature', `sha384:${digest}`)

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })
    const runAction = vi.fn().mockResolvedValue(null)

    const response = await handleWebhookRequest(request, {
      mode: 'sync',
      runAction,
      requireSignature: true,
      authSecret: secret,
    })

    expect(runAction).toHaveBeenCalledWith({
      payload,
      rawBody,
      signature: `sha384:${digest}`,
    })
    expect(response.status).toBe(204)
  })

  test('handleWebhookRequest honors a custom response status', async () => {
    const payload = { ok: 'ASSEMBLY_COMPLETED', assembly_id: 'asm_123' }
    const rawBody = JSON.stringify(payload)
    const formData = new FormData()
    formData.append('transloadit', rawBody)
    formData.append('signature', 'sha384:abc')

    const request = new Request('http://localhost', {
      method: 'POST',
      body: formData,
    })
    const runAction = vi.fn().mockResolvedValue(null)

    const response = await handleWebhookRequest(request, {
      runAction,
      responseStatus: 299,
    })

    expect(runAction).toHaveBeenCalledWith({
      payload,
      rawBody,
      signature: 'sha384:abc',
    })
    expect(response.status).toBe(299)
  })
})
