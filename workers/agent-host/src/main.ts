/**
 * Local Agent Host の起動口。正本 §4.4。
 *
 *   pnpm --filter @astra/worker-agent-host start
 *
 * **Dock とは別プロセス。**Dock を閉じても、これは動き続ける。
 */
import { createLogger } from '@astra/telemetry';
import { LocalAgentHost } from './host.js';
import { httpTransport } from './transport.js';

async function main(): Promise<void> {
  const logger = createLogger({
    service: 'agent-host',
    level: process.env['ASTRA_LOG_LEVEL'] ?? 'info',
  });

  const baseUrl = process.env['ASTRA_API_URL'] ?? 'http://127.0.0.1:8080';
  const token = process.env['ASTRA_HOST_TOKEN'];
  if (!token) {
    // 名乗れないまま起動しない。黙って何もしない process を残さない。
    logger.error('ASTRA_HOST_TOKEN is required; the host cannot register without it');
    process.exitCode = 1;
    return;
  }

  const deviceLabel = process.env['ASTRA_DEVICE_LABEL'] ?? `${process.env['USER'] ?? 'device'}`;
  /*
   * この端末で使えるモデル。**空なら仕事を受けない。**
   * 受けてから失敗するより、受けないほうがよい。
   */
  const models = (process.env['ASTRA_HOST_MODELS'] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  const host = new LocalAgentHost({
    deviceLabel,
    models,
    transport: httpTransport({ baseUrl, token }),
    runner: {
      // 実際の実行は Phase 5（BYOK / Claude Code）で差し込む
      async run({ stillLeased }) {
        if (!stillLeased()) return;
      },
    },
    onError: (error) => logger.warn({ err: error.message }, 'heartbeat failed'),
  });

  const id = await host.start();
  logger.info({ host_id: id, device_label: deviceLabel, models }, 'local agent host started');

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down the local agent host');
    void host.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
