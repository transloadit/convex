import { NextResponse } from 'next/server';
import { runAction, runQuery } from '../../../lib/convex';

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    fileCount?: number;
    guestName?: string;
    uploadCode?: string;
  };
  const fileCount = Number.isFinite(payload.fileCount) ? Math.max(1, payload.fileCount ?? 1) : 1;

  const response = await runAction('createWeddingAssemblyOptions', {
    fileCount,
    guestName: payload.guestName ?? 'Guest',
    uploadCode: payload.uploadCode,
  });

  return NextResponse.json(response);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assemblyId = url.searchParams.get('assemblyId');
  if (!assemblyId) {
    return NextResponse.json({ status: null, results: [] });
  }

  if (url.searchParams.get('refresh') === '1') {
    try {
      await runAction('refreshAssembly', { assemblyId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('Refresh assembly failed', message);
    }
  }

  const [status, results] = await Promise.all([
    runQuery('getAssemblyStatus', { assemblyId }),
    runQuery('listResults', { assemblyId }),
  ]);

  return NextResponse.json({ status, results });
}
