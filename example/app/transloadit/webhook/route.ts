import { parseTransloaditWebhook } from "@transloadit/convex";
import { runAction } from "../../../lib/convex";

export async function POST(request: Request) {
  const { payload, rawBody, signature } =
    await parseTransloaditWebhook(request);

  await runAction("queueWebhook", {
    payload,
    rawBody,
    signature,
    verifySignature: true,
  });

  return new Response(null, { status: 202 });
}
