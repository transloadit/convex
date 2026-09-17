import { handleWebhookRequest } from '@transloadit/convex'
import { runAction } from '../../../lib/convex'
import { isLocalAlbum, localAccessDenied } from '../../../lib/local-session'

export async function POST(request: Request) {
  if (!isLocalAlbum()) return localAccessDenied()
  return handleWebhookRequest(request, {
    mode: 'queue',
    runAction: (args) => runAction('queueWebhook', args),
  })
}
