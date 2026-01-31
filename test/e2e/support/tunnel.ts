import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export type TunnelInfo = {
  url: string;
  notifyUrl?: string;
};

const startTunnelOnce = (port: number) => {
  const process = spawn(
    'node',
    [resolve('scripts/start-webhook-tunnel.ts'), '--json', '--port', `${port}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const info = new Promise<TunnelInfo>((resolvePromise, reject) => {
    let buffer = '';
    const logs: string[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (error) {
        const leftover = buffer.trim();
        if (leftover) {
          logs.push(leftover);
          buffer = '';
        }
      }
      if (error) {
        const details = logs.length ? `\n${logs.join('\n')}` : '';
        reject(new Error(`${error.message}${details}`));
        return;
      }
      resolvePromise(JSON.parse(buffer.trim()) as TunnelInfo);
    };

    timeoutId = setTimeout(() => {
      finish(new Error('Timed out waiting for webhook tunnel URL'));
    }, 90_000);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          try {
            resolvePromise(JSON.parse(line) as TunnelInfo);
            return;
          } catch {
            logs.push(line);
          }
        }
        newlineIndex = buffer.indexOf('\n');
      }
    };

    process.stdout?.on('data', onData);
    process.stderr?.on('data', onData);
    process.on('error', (error) => finish(error));
    process.on('exit', (code) => {
      if (code && code !== 0) {
        finish(new Error(`Webhook tunnel exited with code ${code}`));
      }
    });
  });

  return { process, info };
};

export async function startTunnel(port: number) {
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < 3) {
    attempt += 1;
    try {
      const { process, info } = startTunnelOnce(port);
      return { process, info: await info };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error('Failed to start webhook tunnel');
}
