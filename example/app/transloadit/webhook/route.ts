import { handleWebhookRequest } from '@transloadit/convex';
import { runAction } from '../../../lib/convex';

export async function POST(request: Request) {
  return handleWebhookRequest(request, {
    mode: 'queue',
    runAction: (args) => runAction('queueWebhook', args),
  });
}
