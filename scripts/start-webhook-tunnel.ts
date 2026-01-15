import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const isWindows = process.platform === "win32";
const binaryName = isWindows ? "cloudflared.exe" : "cloudflared";

function isExecutable(path: string) {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return false;
    if (isWindows) return true;
    return Boolean(stats.mode & 0o111);
  } catch {
    return false;
  }
}

function findOnPath(name: string) {
  const pathEntries = (process.env.PATH || "").split(
    process.platform === "win32" ? ";" : ":",
  );
  for (const entry of pathEntries) {
    if (!entry) continue;
    const candidate = join(entry, name);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getDownloadName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") {
    if (arch === "arm64") return "cloudflared-linux-arm64";
    if (arch === "arm") return "cloudflared-linux-arm";
    return "cloudflared-linux-amd64";
  }

  if (platform === "darwin") {
    return arch === "arm64"
      ? "cloudflared-darwin-arm64"
      : "cloudflared-darwin-amd64";
  }

  if (platform === "win32") {
    return arch === "arm64"
      ? "cloudflared-windows-arm64.exe"
      : "cloudflared-windows-amd64.exe";
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

async function ensureCloudflared() {
  const existing = findOnPath(binaryName);
  if (existing) return existing;

  const toolsDir = resolve(".tools");
  mkdirSync(toolsDir, { recursive: true });
  const target = join(toolsDir, binaryName);

  if (isExecutable(target)) {
    return target;
  }

  const assetName = getDownloadName();
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${assetName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download cloudflared: ${response.status} ${response.statusText}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, buffer);
  if (!isWindows) {
    chmodSync(target, 0o755);
  }
  return target;
}

const args = process.argv.slice(2);
const once = args.includes("--once");
const compact = args.includes("--json");
const portFlagIndex = args.indexOf("--port");
const port =
  portFlagIndex !== -1 && args[portFlagIndex + 1]
    ? Number(args[portFlagIndex + 1])
    : 3210;

if (Number.isNaN(port)) {
  throw new Error("Invalid --port value");
}

const cloudflared = await ensureCloudflared();
const tunnel = spawn(
  cloudflared,
  ["tunnel", "--url", `http://localhost:${port}`],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let printed = false;
const urlPattern = /(https:\/\/[-\w]+\.trycloudflare\.com)/i;

function handleOutput(chunk: Buffer) {
  const text = chunk.toString();
  const match = text.match(urlPattern);
  if (match?.[1] && !printed) {
    printed = true;
    const url = match[1];
    const payload = {
      url,
      notifyUrl: `${url}/transloadit/webhook`,
    };
    console.log(JSON.stringify(payload, null, compact ? 0 : 2));

    if (once) {
      tunnel.kill();
    }
  }
}

if (tunnel.stdout) {
  tunnel.stdout.on("data", handleOutput);
}
if (tunnel.stderr) {
  tunnel.stderr.on("data", handleOutput);
}

tunnel.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

tunnel.on("exit", (code) => {
  if (!printed && code && code !== 0) {
    process.exit(code);
  }
});
