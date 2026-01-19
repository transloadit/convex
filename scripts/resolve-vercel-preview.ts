import { setTimeout as sleep } from "node:timers/promises";
import { loadEnv } from "./env.ts";

loadEnv();

const deployHook = process.env.VERCEL_DEPLOY_HOOK ?? "";
const token = process.env.VERCEL_TOKEN ?? "";

if (!deployHook) {
  throw new Error("Missing VERCEL_DEPLOY_HOOK");
}
if (!token) {
  throw new Error("Missing VERCEL_TOKEN");
}

const hookUrl = new URL(deployHook);
const pathSegments = hookUrl.pathname.split("/").filter(Boolean);
const deployIndex = pathSegments.indexOf("deploy");
if (deployIndex === -1 || pathSegments.length < deployIndex + 3) {
  throw new Error("Unable to parse Vercel deploy hook URL");
}

const projectId = pathSegments[deployIndex + 1] ?? "";
const hookId = pathSegments[deployIndex + 2] ?? "";
if (!projectId || !hookId) {
  throw new Error("Missing Vercel project or hook id");
}

const triggerResponse = await fetch(deployHook, { method: "POST" });
if (!triggerResponse.ok) {
  throw new Error(`Vercel deploy hook failed: ${triggerResponse.status}`);
}

const triggerPayload = (await triggerResponse.json().catch(() => ({}))) as {
  job?: { createdAt?: number };
};
const triggerTime =
  typeof triggerPayload.job?.createdAt === "number"
    ? triggerPayload.job.createdAt
    : Date.now();

const deploymentsUrl = new URL("https://api.vercel.com/v6/deployments");
deploymentsUrl.searchParams.set("projectId", projectId);
deploymentsUrl.searchParams.set("limit", "20");

const deadline = Date.now() + 4 * 60 * 1000;
while (Date.now() < deadline) {
  const response = await fetch(deploymentsUrl, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to list Vercel deployments: ${response.status}`);
  }

  const payload = (await response.json()) as {
    deployments?: Array<{
      createdAt?: number;
      readyState?: string;
      url?: string;
      meta?: Record<string, string>;
    }>;
  };

  const deployments = payload.deployments ?? [];
  const matches = deployments
    .filter((deployment) => deployment.meta?.deployHookId === hookId)
    .filter((deployment) => (deployment.createdAt ?? 0) >= triggerTime - 10_000)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const candidate = matches[0];
  if (candidate) {
    if (candidate.readyState === "READY" && candidate.url) {
      process.stdout.write(`https://${candidate.url}`);
      process.exit(0);
    }
    if (candidate.readyState === "ERROR") {
      throw new Error("Vercel deployment failed");
    }
  }

  await sleep(5000);
}

throw new Error("Timed out waiting for Vercel deployment");
