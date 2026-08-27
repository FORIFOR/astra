/**
 * Local Agent Host の起動口。正本 §4.4。
 *
 *   pnpm --filter @astra/worker-agent-host start
 *
 * **Dock とは別プロセス。**Dock を閉じても、これは動き続ける。
 */
import { createLogger } from '@astra/telemetry';
import { credentialRef, providerConfig, type OauthProvider } from '@astra/oauth';
import { LocalAgentHost } from './host.js';
import { httpTransport } from './transport.js';
import { keychainFor } from './keychain.js';
import { ConnectorRuntime } from './connector-steps.js';
import { HostStepLoop } from './step-loop.js';
import { httpStepTransport } from './step-transport.js';
import { ClaudeCodeCli } from './claude-code.js';
import { LlmRuntime } from './llm-steps.js';
import { CompositeRunner } from './runner.js';

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
   * 言葉を扱う仕事も端末で。正本 §21、UI/UX §22。
   *
   * **Astra は共通の API キーを持たない。**利用者が持ち込んだ利用権は
   * 端末の側にあるので、呼ぶのも端末になる。
   * Claude Code のログインは Claude Code のもので、Astra は読まない。
   */
  const llm = new LlmRuntime({
    claudeCode: new ClaudeCodeCli({
      ...(process.env['ASTRA_CLAUDE_CODE_PATH']
        ? { command: process.env['ASTRA_CLAUDE_CODE_PATH'] }
        : {}),
      ...(process.env['ASTRA_CLAUDE_CODE_MODEL']
        ? { model: process.env['ASTRA_CLAUDE_CODE_MODEL'] }
        : {}),
    }),
  });

  /*
   * この端末で使えるモデル。**空なら仕事を受けない。**
   * 受けてから失敗するより、受けないほうがよい。
   *
   * **名乗る前に確かめる。**環境変数から読んでいた間、
   * Claude Code が入っていない端末が「claude_code が使えます」と名乗り、
   * 仕事を受けてから失敗していた。名乗りは調べた結果でなければ意味が無い。
   */
  const probed = await llm.options();
  const models = probed.filter((option) => option.available).map((option) => option.kind);
  logger.info(
    { models: probed.map((o) => ({ kind: o.kind, available: o.available, reason: o.reason })) },
    'language models on this device',
  );

  /*
   * 同意の結果。**この端末が保持する。**
   * `ASTRA_GRANTED_SCOPES` は `plugin=scope,scope;plugin=...` の形。
   * 空なら何も許されていないものとして扱う（既定で通さない）。
   */
  const grantedScopes = parseGrants(process.env['ASTRA_GRANTED_SCOPES'] ?? '');
  const redirectUri = process.env['ASTRA_OAUTH_REDIRECT_URI'] ?? 'http://127.0.0.1:0/callback';

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

  /*
   * connector の step を取りに来る側。正本 §2.4・§21。
   *
   * **鍵はこの端末から出ない。**cloud から来るのは「何をしてほしいか」だけで、
   * トークンは OS の資格情報ストアから、呼ぶ直前にだけ読む。
   */
  const secrets = keychainFor(process.platform, process.env['USER'] ?? 'astra');
  const runtime = new ConnectorRuntime({
    secrets,
    credentialRefFor: credentialRef,
    /*
     * 実際に許された scope。**要求した scope ではない。**
     * 同意画面で外された分をここに含めると、
     * 「許したはずが無い操作」が端末側の検査を通ってしまう。
     */
    grantedScopes: (pluginId) => grantedScopes[pluginId] ?? [],
    // 設定されていない提供者は更新しない。切れたら繋ぎ直しを促す。
    refreshConfig: (provider) => {
      const config = providerConfig(provider as OauthProvider, [], process.env);
      return config ? { ...config, redirectUri: redirectUri } : null;
    },
  });

  const steps = new HostStepLoop({
    transport: httpStepTransport({ baseUrl, token }),
    runner: new CompositeRunner([runtime, llm]),
    onError: (error) => logger.warn({ err: error.message }, 'a step could not be handled'),
  });
  void steps.start(id);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down the local agent host');
    void host.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** `plugin=scope,scope;plugin=...` を読む。読めない部分は捨てる（推測しない）。 */
export function parseGrants(value: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const entry of value.split(';')) {
    const [pluginId, scopes] = entry.split('=');
    if (!pluginId?.trim() || !scopes) continue;
    out[pluginId.trim()] = scopes
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return out;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
