import { setTimeout as sleep } from "node:timers/promises";
import { loadEnv } from "./env.ts";

loadEnv();

const deployHook = process.env.VERCEL_PREVIEW_DEPLOY_HOOK ?? "";
const githubToken = process.env.GITHUB_TOKEN ?? "";
const githubRepo = process.env.GITHUB_REPOSITORY ?? "";
const githubSha = process.env.GITHUB_SHA ?? "";

if (!githubToken) {
  throw new Error("Missing GITHUB_TOKEN");
}
if (!githubRepo || !githubSha) {
  throw new Error("Missing GITHUB_REPOSITORY or GITHUB_SHA");
}

const apiBase = "https://api.github.com";
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${githubToken}`,
  "user-agent": "convex-e2e-preview",
};

const triggerPreviewDeploy = async () => {
  if (!deployHook) return;
  const response = await fetch(deployHook, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Vercel deploy hook failed: ${response.status}`);
  }
};

const fetchDeploymentUrl = async (): Promise<string | null> => {
  const deploymentsResponse = await fetch(
    `${apiBase}/repos/${githubRepo}/deployments?sha=${githubSha}`,
    { headers },
  );
  if (!deploymentsResponse.ok) {
    throw new Error(
      `Failed to list deployments: ${deploymentsResponse.status}`,
    );
  }
  const deployments = (await deploymentsResponse.json()) as Array<{
    environment?: string;
    statuses_url: string;
  }>;

  for (const deployment of deployments) {
    if (
      deployment.environment &&
      deployment.environment.toLowerCase() !== "preview"
    ) {
      continue;
    }
    const statusesResponse = await fetch(deployment.statuses_url, { headers });
    if (!statusesResponse.ok) {
      continue;
    }
    const statuses = (await statusesResponse.json()) as Array<{
      state?: string;
      target_url?: string;
    }>;
    const success = statuses.find((status) => status.state === "success");
    if (success?.target_url) return success.target_url;
  }

  return null;
};

const fetchCheckRunUrl = async (): Promise<string | null> => {
  const response = await fetch(
    `${apiBase}/repos/${githubRepo}/commits/${githubSha}/check-runs`,
    { headers },
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    check_runs?: Array<{
      name?: string;
      details_url?: string;
      app?: { slug?: string };
      conclusion?: string | null;
    }>;
  };
  const checks = payload.check_runs ?? [];
  const vercelCheck = checks.find(
    (check) =>
      check.app?.slug === "vercel" &&
      check.conclusion === "success" &&
      check.details_url,
  );
  return vercelCheck?.details_url ?? null;
};

await triggerPreviewDeploy();

const deadline = Date.now() + 6 * 60 * 1000;
while (Date.now() < deadline) {
  const deploymentUrl = await fetchDeploymentUrl();
  if (deploymentUrl) {
    process.stdout.write(deploymentUrl);
    process.exit(0);
  }

  const checkUrl = await fetchCheckRunUrl();
  if (checkUrl) {
    process.stdout.write(checkUrl);
    process.exit(0);
  }

  await sleep(5000);
}

throw new Error("Timed out waiting for preview deployment URL");
