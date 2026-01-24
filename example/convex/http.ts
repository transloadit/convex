import { buildWebhookQueueArgs } from "@transloadit/convex";
import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

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
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => {
    const siteUrl = requireEnv("CONVEX_SITE_URL");
    const jwksUrl = new URL(".well-known/jwks.json", siteUrl).toString();
    const authorizeUrl = new URL("oauth/authorize", siteUrl).toString();
    return new Response(
      JSON.stringify({
        issuer: siteUrl,
        jwks_uri: jwksUrl,
        authorization_endpoint: authorizeUrl,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
        },
      },
    );
  }),
});

http.route({
  path: "/.well-known/jwks.json",
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
    const args = await buildWebhookQueueArgs(request, {
      authSecret: requireEnv("TRANSLOADIT_SECRET"),
      requireSignature: false,
    });

    await ctx.runAction(api.transloadit.queueWebhook, args);

    return new Response(null, { status: 202 });
  }),
});

export default http;
