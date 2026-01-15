import { httpAction, httpRouter } from "convex/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/transloadit/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const formData = await request.formData();
    const rawPayload = formData.get("transloadit");
    const signature = formData.get("signature");

    if (typeof rawPayload !== "string") {
      return new Response("Missing payload", { status: 400 });
    }

    const payload = JSON.parse(rawPayload);

    await ctx.runAction(api.transloadit.handleWebhook, {
      payload,
      rawBody: rawPayload,
      signature: typeof signature === "string" ? signature : undefined,
    });

    return new Response(null, { status: 204 });
  }),
});

export default http;
