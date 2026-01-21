import { handleWebhookRequest } from "../../../../src/component/apiUtils.ts";
import { runAction } from "../../../lib/convex";

export async function POST(request: Request) {
  return handleWebhookRequest(request, {
    mode: "queue",
    runAction: (args) => runAction("queueWebhook", args),
  });
}
