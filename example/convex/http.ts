import { parseTransloaditWebhook } from "@transloadit/convex";
import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

http.route({
  path: "/auth/jwks",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(requireEnv("JWKS"), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
      },
    });
  }),
});

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
