import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

/**
 * OS-owned process mutex. A listening loopback socket is released even on SIGKILL;
 * it never exchanges data and needs no stale PID-file or refresh-token replay.
 * Port collisions fail closed before touching credentials (they never pick another lock).
 */
export async function acquireHostInstance(key: string, port = instancePort(key)) {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', () =>
      reject(
        new Error(
          '実行ホストの起動ロックを取得できません。同じホストが起動中か、ロック用のローカルポートが使用中です。既存のホストを終了してから起動してください。',
        ),
      ),
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve());
  });
  server.unref();
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : port,
    release: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function instancePort(key: string): number {
  // Below macOS's default ephemeral range; occasional unrelated service collisions
  // are reported explicitly instead of risking two users of a refresh chain.
  return 32000 + (createHash('sha256').update(key).digest().readUInt16BE(0) % 8000);
}
