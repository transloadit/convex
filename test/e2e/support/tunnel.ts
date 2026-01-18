import { spawn } from "node:child_process";
import { resolve } from "node:path";

export type TunnelInfo = {
  url: string;
  notifyUrl?: string;
};

export async function startTunnel(port: number) {
  const process = spawn(
    "node",
    [resolve("scripts/start-webhook-tunnel.ts"), "--json", "--port", `${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const info = await new Promise<TunnelInfo>((resolvePromise, reject) => {
    let buffer = "";
    const logs: string[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (error) {
        const details = logs.length ? `\n${logs.join("\n")}` : "";
        reject(new Error(`${error.message}${details}`));
        return;
      }
      resolvePromise(JSON.parse(buffer.trim()) as TunnelInfo);
    };

    timeoutId = setTimeout(() => {
      finish(new Error("Timed out waiting for webhook tunnel URL"));
    }, 90_000);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) return;
      try {
        resolvePromise(JSON.parse(line) as TunnelInfo);
      } catch {
        logs.push(line);
      }
    };

    process.stdout?.on("data", onData);
    process.stderr?.on("data", onData);
    process.on("error", (error) => finish(error));
    process.on("exit", (code) => {
      if (code && code !== 0) {
        finish(new Error(`Webhook tunnel exited with code ${code}`));
      }
    });
  });

  return { process, info };
}
