/// <reference types="vite/client" />

import { createHmac } from 'node:crypto';
import { convexTest } from 'convex-test';
import { describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api.ts';
import schema from './schema.ts';
import { modules } from './setup.test.ts';

process.env.TRANSLOADIT_KEY = 'test-key';
process.env.TRANSLOADIT_SECRET = 'test-secret';

describe('Transloadit component lib', () => {
  test('handleWebhook stores assembly and results', async () => {
    const t = convexTest(schema, modules);

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
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex');

    const result = await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    });

    expect(result.assemblyId).toBe('asm_123');
    expect(result.resultCount).toBe(1);

    const assembly = await t.query(api.lib.getAssemblyStatus, {
      assemblyId: 'asm_123',
    });

    expect(assembly?.assemblyId).toBe('asm_123');
    expect(assembly?.ok).toBe('ASSEMBLY_COMPLETED');

    const results = await t.query(api.lib.listResults, {
      assemblyId: 'asm_123',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.stepName).toBe('resized');
  });

  test('listAlbumResults returns album-scoped results', async () => {
    const t = convexTest(schema, modules);

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
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex');

    await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    });

    const results = await t.query(api.lib.listAlbumResults, {
      album: 'wedding-gallery',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.album).toBe('wedding-gallery');
    expect(results[0]?.userId).toBe('user_123');
  });

  test('handleWebhook stores url when ssl_url missing', async () => {
    const t = convexTest(schema, modules);

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
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex');

    await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    });

    const results = await t.query(api.lib.listResults, {
      assemblyId: 'asm_url',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.sslUrl).toBe('https://example.com/file-3.jpg');
  });

  test('listResults exposes expected fields for common robot outputs', async () => {
    const t = convexTest(schema, modules);

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
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha1', 'test-secret').update(rawBody).digest('hex');

    await t.action(api.lib.handleWebhook, {
      payload,
      rawBody,
      signature: `sha1:${signature}`,
    });

    const results = await t.query(api.lib.listResults, {
      assemblyId: 'asm_schema',
    });

    expect(results).toHaveLength(3);

    const byStep = new Map(results.map((result) => [result.stepName, result]));
    const image = byStep.get('images_resized');
    const video = byStep.get('videos_encoded');
    const thumb = byStep.get('videos_thumbs_output');

    expect(image?.sslUrl).toBe('https://example.com/img.jpg');
    expect(image?.mime).toBe('image/jpeg');
    expect(image?.raw?.width).toBe(1600);
    expect(image?.raw?.height).toBe(1200);

    expect(video?.sslUrl).toBe('https://example.com/vid.mp4');
    expect(video?.mime).toBe('video/mp4');
    expect(video?.raw?.duration).toBe(12.5);

    expect(thumb?.sslUrl).toBe('https://example.com/thumb.jpg');
    expect(thumb?.raw?.original_id).toBe('vid_1');
  });

  test('handleWebhook requires rawBody when verifying signature', async () => {
    const t = convexTest(schema, modules);
    const payload = { assembly_id: 'asm_missing' };
    const signature = createHmac('sha1', 'test-secret')
      .update(JSON.stringify(payload))
      .digest('hex');

    await expect(
      t.action(api.lib.handleWebhook, {
        payload,
        signature: `sha1:${signature}`,
      }),
    ).rejects.toThrow('Missing rawBody for webhook verification');
  });

  test('handleWebhook can skip verification when configured', async () => {
    const t = convexTest(schema, modules);
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
    };

    const result = await t.action(api.lib.handleWebhook, {
      payload,
      verifySignature: false,
    });

    expect(result.assemblyId).toBe('asm_skip');
    expect(result.resultCount).toBe(1);
  });

  test('createAssemblyOptions includes expected upload count when provided', async () => {
    const t = convexTest(schema, modules);

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
    });

    const params = JSON.parse(result.params) as Record<string, unknown>;
    expect(params.num_expected_upload_files).toBe(3);
  });

  test('queueWebhook rejects invalid signature', async () => {
    const t = convexTest(schema, modules);
    const payload = { assembly_id: 'asm_bad' };
    const rawBody = JSON.stringify(payload);

    await expect(
      t.action(api.lib.queueWebhook, {
        payload,
        rawBody,
        signature: 'sha1:bad',
      }),
    ).rejects.toThrow('Invalid Transloadit webhook signature');
  });

  test('refreshAssembly fetches status and stores results', async () => {
    const t = convexTest(schema, modules);

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
    };

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await t.action(api.lib.refreshAssembly, {
        assemblyId: 'asm_456',
        config: { authKey: 'test-key', authSecret: 'test-secret' },
      });

      expect(result.assemblyId).toBe('asm_456');
      expect(result.ok).toBe('ASSEMBLY_COMPLETED');

      const requestInfo = fetchMock.mock.calls[0]?.[0];
      const requestUrl =
        typeof requestInfo === 'string'
          ? requestInfo
          : requestInfo instanceof URL
            ? requestInfo.toString()
            : requestInfo instanceof Request
              ? requestInfo.url
              : '';
      if (!requestUrl) {
        throw new Error('Expected fetch to be called with a URL string');
      }
      const url = new URL(requestUrl);
      expect(url.origin).toBe('https://api2.transloadit.com');
      expect(url.searchParams.get('signature')).toBeTruthy();
      expect(url.searchParams.get('params')).toBeTruthy();

      const assembly = await t.query(api.lib.getAssemblyStatus, {
        assemblyId: 'asm_456',
      });
      expect(assembly?.ok).toBe('ASSEMBLY_COMPLETED');

      const results = await t.query(api.lib.listResults, {
        assemblyId: 'asm_456',
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.stepName).toBe('resized');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
