import { parseTransloaditWebhook } from "@transloadit/convex";
import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { payload, rawBody, signature } =
      await parseTransloaditWebhook(request);

    await ctx.runAction(api.transloadit.queueWebhook, {
      payload,
      rawBody,
      signature,
    });

    return new Response(null, { status: 202 });
  }),
});

export default http;
