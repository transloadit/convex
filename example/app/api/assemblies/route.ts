import { NextResponse } from "next/server";
import { runAction, runQuery } from "../../../lib/convex";
import { weddingSteps } from "../../../lib/transloadit";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    fileCount?: number;
    guestName?: string;
  };
  const notifyUrl = process.env.TRANSLOADIT_NOTIFY_URL;
  if (!notifyUrl) {
    return NextResponse.json(
      { error: "Missing TRANSLOADIT_NOTIFY_URL" },
      { status: 500 },
    );
  }

  const fileCount = Number.isFinite(payload.fileCount)
    ? Math.max(1, payload.fileCount ?? 1)
    : 1;

  const response = await runAction("createAssembly", {
    steps: weddingSteps,
    notifyUrl,
    numExpectedUploadFiles: fileCount,
    fields: {
      guestName: payload.guestName ?? "Guest",
      album: "wedding-gallery",
    },
  });

  return NextResponse.json(response);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assemblyId = url.searchParams.get("assemblyId");
  if (!assemblyId) {
    return NextResponse.json({ status: null, results: [] });
  }

  if (url.searchParams.get("refresh") === "1") {
    await runAction("refreshAssembly", { assemblyId });
  }

  const [status, results] = await Promise.all([
    runQuery("getAssemblyStatus", { assemblyId }),
    runQuery("listResults", { assemblyId }),
  ]);

  return NextResponse.json({ status, results });
}
