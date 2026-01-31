import { buildWebhookQueueArgs } from '@transloadit/convex';
import { httpRouter } from 'convex/server';
import { api } from './_generated/api';
import { httpAction } from './_generated/server';
import { auth } from './auth';

const http = httpRouter();
auth.addHttpRoutes(http);

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

http.route({
  path: '/transloadit/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const args = await buildWebhookQueueArgs(request, {
      authSecret: requireEnv('TRANSLOADIT_SECRET'),
      requireSignature: false,
    });

    await ctx.runAction(api.transloadit.queueWebhook, args);

    return new Response(null, { status: 202 });
  }),
});

export default http;
