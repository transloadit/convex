/// <reference types="vite/client" />

import { createHmac } from 'node:crypto'
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api.ts'
import schema from './schema.ts'
import { modules } from './setup.test.ts'

process.env.TRANSLOADIT_KEY = 'test-key'
process.env.TRANSLOADIT_SECRET = 'test-secret'

describe('Transloadit component lib', () => {
  test('checks expected upload fields before persisting a refreshed assembly', async () => {
    const t = convexTest(schema, modules)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          assembly_id: 'scoped',
          ok: 'ASSEMBLY_COMPLETED',
          fields: { album: 'private-album', userId: 'another-user' },
          results: { images: [{ id: 'photo', ssl_url: 'https://example.com/private.jpg' }] },
        }),
      ),
    )
    try {
      await expect(
        t.action(api.lib.refreshAssembly, {
          assemblyId: 'scoped',
          expectedFields: { album: 'wedding-gallery', userId: 'guest' },
        }),
      ).rejects.toThrow('expected fields')
      expect(await t.query(api.lib.getAssemblyStatus, { assemblyId: 'scoped' })).toBeNull()
      expect(await t.query(api.lib.listResults, { assemblyId: 'scoped' })).toEqual([])
      await t.action(api.lib.refreshAssembly, {
        assemblyId: 'scoped',
        expectedFields: { album: 'private-album', userId: 'another-user' },
      })
      expect(await t.query(api.lib.listResults, { assemblyId: 'scoped' })).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  test.each(['handleWebhook', 'queueWebhook'] as const)(
    '%s persists only the signed body, even if the separate payload is changed',
    async (method) => {
      vi.useFakeTimers()
      try {
        const t = convexTest(schema, modules)
        const signedPayload = { assembly_id: 'signed', ok: 'ASSEMBLY_COMPLETED' }
        const rawBody = JSON.stringify(signedPayload)
        const signature = createHmac('sha384', 'test-secret').update(rawBody).digest('hex')
        const result = await t.action(api.lib[method], {
          rawBody,
          signature: `sha384:${signature}`,
          payload: { assembly_id: 'tampered', ok: 'ASSEMBLY_COMPLETED' },
        })
        expect(result.assemblyId).toBe('signed')
        await t.finishAllScheduledFunctions(vi.runAllTimers)
        expect(await t.query(api.lib.getAssemblyStatus, { assemblyId: 'signed' })).not.toBeNull()
        expect(await t.query(api.lib.getAssemblyStatus, { assemblyId: 'tampered' })).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    },
  )

  test('queueWebhook preserves an explicit trusted verification opt-out when processing', async () => {
    vi.useFakeTimers()
    try {
      const t = convexTest(schema, modules)
      await t.action(api.lib.queueWebhook, {
        payload: { assembly_id: 'trusted', ok: 'ASSEMBLY_COMPLETED' },
        verifySignature: false,
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(await t.query(api.lib.getAssemblyStatus, { assemblyId: 'trusted' })).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('handleWebhook stores assembly and results', async () => {
    const t = convexTest(schema, modules)

    const payload = {
      assembly_id: 'asm_123',
      ok: 'ASSEMBLY_COMPLETED',
      message: 'Assembly complete',
      results: {
        resized: [
          {
            id: 'file_1',
            ssl_url: 'https://example.com/file.jpg',
            name: 'file.jpg',
            size: 12345,
            mime: 'image/jpeg',
          },
        ],
      },
    }

    const rawBody = JSON.stringify(payload)
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex')

    const result = await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    })

    expect(result.assemblyId).toBe('asm_123')
    expect(result.resultCount).toBe(1)

    const assembly = await t.query(api.lib.getAssemblyStatus, {
      assemblyId: 'asm_123',
    })

    expect(assembly?.assemblyId).toBe('asm_123')
    expect(assembly?.ok).toBe('ASSEMBLY_COMPLETED')

    const results = await t.query(api.lib.listResults, {
      assemblyId: 'asm_123',
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.stepName).toBe('resized')
  })

  test('listAlbumResults returns album-scoped results', async () => {
    const t = convexTest(schema, modules)

    const payload = {
      assembly_id: 'asm_album',
      ok: 'ASSEMBLY_COMPLETED',
      fields: {
        album: 'wedding-gallery',
        userId: 'user_123',
      },
      results: {
        resized: [
          {
            id: 'file_album',
            ssl_url: 'https://example.com/album.jpg',
            name: 'album.jpg',
            size: 100,
            mime: 'image/jpeg',
          },
        ],
      },
    }

    const rawBody = JSON.stringify(payload)
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex')

    await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    })

    const results = await t.query(api.lib.listAlbumResults, {
      album: 'wedding-gallery',
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.album).toBe('wedding-gallery')
    expect(results[0]?.userId).toBe('user_123')
  })

  test('listAlbumResults bounds and ages rows in the index and joins only requested fields', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = convexTest(schema, modules)
      const persist = async (assemblyId: string, fields: Record<string, unknown>, count = 1) => {
        await t.action(api.lib.handleWebhook, {
          verifySignature: false,
          payload: {
            assembly_id: assemblyId,
            ok: 'ASSEMBLY_COMPLETED',
            fields: { album: 'wedding-gallery', ...fields },
            results: {
              images_output: Array.from({ length: count }, (_, index) => ({
                id: `${assemblyId}-${index}`,
                ssl_url: `https://example.com/${assemblyId}-${index}.jpg`,
              })),
            },
          },
        })
      }
      vi.setSystemTime(1000)
      await persist('old', { guestName: 'Old' })
      vi.setSystemTime(2000)
      await persist('named', { guestName: 'Олена', privateMetadata: 'not-joined' }, 2)
      vi.setSystemTime(3000)
      await persist('legacy', {})
      await persist('elsewhere', { album: 'another-album', guestName: 'Other' })

      const recent = await t.query(api.lib.listAlbumResults, {
        album: 'wedding-gallery',
        createdAfter: 1000,
        assemblyFields: ['guestName', 'missing'],
      })
      expect(recent.map((result) => [result.assemblyId, result.assemblyFields])).toEqual([
        ['legacy', {}],
        ['named', { guestName: 'Олена' }],
        ['named', { guestName: 'Олена' }],
      ])
      const all = await t.query(api.lib.listAlbumResults, { album: 'wedding-gallery' })
      expect(all.map((result) => result.assemblyId)).toEqual(['legacy', 'named', 'named', 'old'])
      expect(all.every((result) => !('assemblyFields' in result))).toBe(true)
      const bounded = (limit: number) =>
        t.query(api.lib.listAlbumResults, { album: 'wedding-gallery', limit })
      expect(await bounded(2.5)).toHaveLength(2)
      expect(await bounded(0)).toHaveLength(1)
      for (const args of [
        { limit: Number.NaN },
        { limit: Number.POSITIVE_INFINITY },
        { createdAfter: Number.NaN },
        { createdAfter: Number.NEGATIVE_INFINITY },
      ]) {
        await expect(
          t.query(api.lib.listAlbumResults, { album: 'wedding-gallery', ...args }),
        ).rejects.toThrow('Invalid album result')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  test('listAlbumResults ends the page before joined Assemblies exceed the read limit', async () => {
    // Convex's 16 MiB read limit is per query: nested component calls share the caller's budget.
    const t = convexTest({ schema, modules, transactionLimits: true })
    const assemblyIds = Array.from({ length: 20 }, (_, index) => `large-${index}`)
    for (const [index, assemblyId] of assemblyIds.entries()) {
      await t.run(async (ctx) => {
        // Near Convex's 1 MiB document limit, like an Assembly with hundreds of files.
        await ctx.db.insert('assemblies', {
          assemblyId,
          fields: { album: 'wedding-gallery', guestName: `Guest ${index}` },
          raw: 'x'.repeat(900_000),
          createdAt: index,
          updatedAt: index,
        })
        await ctx.db.insert('results', {
          assemblyId,
          album: 'wedding-gallery',
          stepName: 'images_output',
          raw: {},
          createdAt: index,
        })
      })
    }
    const newestFirst = [...assemblyIds].reverse()
    const rows = await t.query(api.lib.listAlbumResults, { album: 'wedding-gallery' })
    expect(rows.map((result) => result.assemblyId)).toEqual(newestFirst)

    // Joining all 20 would read ~17 MiB: the page ends at the newest Assemblies that fit.
    const joined = await t.query(api.lib.listAlbumResults, {
      album: 'wedding-gallery',
      assemblyFields: ['guestName'],
    })
    expect(joined.length).toBeGreaterThanOrEqual(15)
    expect(joined.length).toBeLessThan(20)
    expect(joined.map((result) => [result.assemblyId, result.assemblyFields])).toEqual(
      newestFirst.slice(0, joined.length).map((id) => [id, { guestName: `Guest ${id.slice(6)}` }]),
    )
  })

  test('handleWebhook stores url when ssl_url missing', async () => {
    const t = convexTest(schema, modules)

    const payload = {
      assembly_id: 'asm_url',
      ok: 'ASSEMBLY_COMPLETED',
      results: {
        stored: [
          {
            id: 'file_3',
            url: 'https://example.com/file-3.jpg',
            name: 'file-3.jpg',
            size: 42,
            mime: 'image/jpeg',
          },
        ],
      },
    }

    const rawBody = JSON.stringify(payload)
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex')

    await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    })

    const results = await t.query(api.lib.listResults, {
      assemblyId: 'asm_url',
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.sslUrl).toBe('https://example.com/file-3.jpg')
  })

  test('listResults exposes expected fields for common robot outputs', async () => {
    const t = convexTest(schema, modules)

    const payload = {
      assembly_id: 'asm_schema',
      ok: 'ASSEMBLY_COMPLETED',
      results: {
        images_resized: [
          {
            id: 'img_1',
            ssl_url: 'https://example.com/img.jpg',
            name: 'img.jpg',
            mime: 'image/jpeg',
            width: 1600,
            height: 1200,
          },
        ],
        videos_encoded: [
          {
            id: 'vid_1',
            ssl_url: 'https://example.com/vid.mp4',
            name: 'vid.mp4',
            mime: 'video/mp4',
            duration: 12.5,
          },
        ],
        videos_thumbs_output: [
          {
            id: 'thumb_1',
            ssl_url: 'https://example.com/thumb.jpg',
            name: 'thumb.jpg',
            mime: 'image/jpeg',
            original_id: 'vid_1',
          },
        ],
      },
    }

    const rawBody = JSON.stringify(payload)
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex')

    await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    })

    const results = await t.query(api.lib.listResults, {
      assemblyId: 'asm_schema',
    })

    expect(results).toHaveLength(3)

    const byStep = new Map(results.map((result) => [result.stepName, result]))
    const image = byStep.get('images_resized')
    const video = byStep.get('videos_encoded')
    const thumb = byStep.get('videos_thumbs_output')

    expect(image?.sslUrl).toBe('https://example.com/img.jpg')
    expect(image?.mime).toBe('image/jpeg')
    expect(image?.raw?.width).toBe(1600)
    expect(image?.raw?.height).toBe(1200)

    expect(video?.sslUrl).toBe('https://example.com/vid.mp4')
    expect(video?.mime).toBe('video/mp4')
    expect(video?.raw?.duration).toBe(12.5)

    expect(thumb?.sslUrl).toBe('https://example.com/thumb.jpg')
    expect(thumb?.raw?.original_id).toBe('vid_1')
  })

  test('handleWebhook requires rawBody when verifying signature', async () => {
    const t = convexTest(schema, modules)
    const payload = { assembly_id: 'asm_missing' }
    const signature = createHmac('sha1', 'test-secret')
      .update(JSON.stringify(payload))
      .digest('hex')

    await expect(
      t.action(api.lib.handleWebhook, {
        payload,
        signature: `sha1:${signature}`,
      }),
    ).rejects.toThrow('Missing rawBody for webhook verification')
  })

  test('handleWebhook can skip verification when configured', async () => {
    const t = convexTest(schema, modules)
    const payload = {
      assembly_id: 'asm_skip',
      ok: 'ASSEMBLY_COMPLETED',
      results: {
        resized: [
          {
            id: 'file_skip',
            ssl_url: 'https://example.com/skip.jpg',
            name: 'skip.jpg',
            size: 123,
            mime: 'image/jpeg',
          },
        ],
      },
    }

    const result = await t.action(api.lib.handleWebhook, {
      payload,
      verifySignature: false,
    })

    expect(result.assemblyId).toBe('asm_skip')
    expect(result.resultCount).toBe(1)
  })

  test('createAssemblyOptions includes expected upload count when provided', async () => {
    const t = convexTest(schema, modules)

    const result = await t.action(api.lib.createAssemblyOptions, {
      steps: {
        resize: {
          robot: '/image/resize',
          width: 120,
          height: 120,
        },
      },
      numExpectedUploadFiles: 3,
      config: { authKey: 'test-key', authSecret: 'test-secret' },
    })

    const params = JSON.parse(result.params) as Record<string, unknown>
    expect(params.num_expected_upload_files).toBe(3)
  })

  test('queueWebhook rejects invalid signature', async () => {
    const t = convexTest(schema, modules)
    const payload = { assembly_id: 'asm_bad' }
    const rawBody = JSON.stringify(payload)

    await expect(
      t.action(api.lib.queueWebhook, {
        payload,
        rawBody,
        signature: 'sha1:bad',
      }),
    ).rejects.toThrow('Invalid Transloadit webhook signature')
  })

  test('refreshAssembly fetches status and stores results', async () => {
    const t = convexTest(schema, modules)

    const payload = {
      assembly_id: 'asm_456',
      ok: 'ASSEMBLY_COMPLETED',
      message: 'Assembly complete',
      results: {
        resized: [
          {
            id: 'file_2',
            ssl_url: 'https://example.com/file-2.jpg',
            name: 'file-2.jpg',
            size: 54321,
            mime: 'image/jpeg',
          },
        ],
      },
    }

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await t.action(api.lib.refreshAssembly, {
        assemblyId: 'asm_456',
        config: { authKey: 'test-key', authSecret: 'test-secret' },
      })

      expect(result.assemblyId).toBe('asm_456')
      expect(result.ok).toBe('ASSEMBLY_COMPLETED')

      const requestInfo = fetchMock.mock.calls[0]?.[0]
      const requestUrl =
        typeof requestInfo === 'string'
          ? requestInfo
          : requestInfo instanceof URL
            ? requestInfo.toString()
            : requestInfo instanceof Request
              ? requestInfo.url
              : ''
      if (!requestUrl) {
        throw new Error('Expected fetch to be called with a URL string')
      }
      const url = new URL(requestUrl)
      expect(url.origin).toBe('https://api2.transloadit.com')
      expect(url.searchParams.get('signature')).toBeTruthy()
      expect(url.searchParams.get('params')).toBeTruthy()

      const assembly = await t.query(api.lib.getAssemblyStatus, {
        assemblyId: 'asm_456',
      })
      expect(assembly?.ok).toBe('ASSEMBLY_COMPLETED')

      const results = await t.query(api.lib.listResults, {
        assemblyId: 'asm_456',
      })
      expect(results).toHaveLength(1)
      expect(results[0]?.stepName).toBe('resized')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
