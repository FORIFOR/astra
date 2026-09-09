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
import { liveFaultTransport } from './live-fault-transport.js';
import { ConnectorRuntime } from './connector-steps.js';
import { HostStepLoop } from './step-loop.js';
import { httpStepTransport } from './step-transport.js';
import { CodexCli } from './codex.js';
import { ClaudeCodeCli } from './claude-code.js';
import { LlmRuntime } from './llm-steps.js';
import { CompositeRunner } from './runner.js';
import type { WorkSyncState } from '@astra/contracts';
import { DEFAULT_SYNC_INTERVAL_MS, WorkSyncLoop } from './work-sync.js';
import {
  grantsFromConnections,
  knownPluginIds,
  mergeGrants,
  type ConnectionRecord,
} from './grants.js';

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
  const preferredCli = process.env['ASTRA_LLM_CLI'];
  if (preferredCli && !['codex', 'claude_code'].includes(preferredCli))
    throw new Error('ASTRA_LLM_CLI must be codex or claude_code');
  const llm = new LlmRuntime({
    ...(preferredCli !== 'claude_code'
      ? {
          codex: new CodexCli({
            ...(process.env['ASTRA_CODEX_PATH']
              ? { command: process.env['ASTRA_CODEX_PATH'] }
              : {}),
            ...(process.env['ASTRA_CODEX_MODEL']
              ? { model: process.env['ASTRA_CODEX_MODEL'] }
              : {}),
          }),
        }
      : {}),
    ...(preferredCli !== 'codex'
      ? {
          claudeCode: new ClaudeCodeCli({
            ...(process.env['ASTRA_CLAUDE_CODE_PATH']
              ? { command: process.env['ASTRA_CLAUDE_CODE_PATH'] }
              : {}),
            ...(process.env['ASTRA_CLAUDE_CODE_MODEL']
              ? { model: process.env['ASTRA_CLAUDE_CODE_MODEL'] }
              : {}),
          }),
        }
      : {}),
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
  const envGrants = parseGrants(process.env['ASTRA_GRANTED_SCOPES'] ?? '');
  /*
   * 許可の正本は cloud の接続記録（実際に許された provider scope）。環境変数は harness の上書き。
   * 起動時に読み、同期の周期で読み直す（繋ぎ直し・切断が効くように）。
   */
  let grantedScopes: Record<string, string[]> = mergeGrants({}, envGrants);
  const redirectUri = process.env['ASTRA_OAUTH_REDIRECT_URI'] ?? 'http://127.0.0.1:0/callback';

  const refreshGrants = async (): Promise<void> => {
    const items: ConnectionRecord[] = [];
    for (const pluginId of knownPluginIds()) {
      try {
        const response = await fetch(
          `${baseUrl}/v1/plugins/${encodeURIComponent(pluginId)}/connections`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok) continue;
        const body = (await response.json()) as { items?: ConnectionRecord[] };
        items.push(...(body.items ?? []));
      } catch {
        // 読めなければ今の許可のまま。無いものを許したことにはしない。
      }
    }
    grantedScopes = mergeGrants(grantsFromConnections(items), envGrants);
  };
  await refreshGrants();
  logger.info({ grants: grantedScopes }, 'connector permissions from the cloud connection records');

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
  const faultFetch = liveFaultTransport(process.env);
  const runtime = new ConnectorRuntime({
    secrets,
    ...(faultFetch ? { fetch: faultFetch } : {}),
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

  /*
   * Work Context の同期。正本 §6、Work Context 仕様。
   *
   * 繋いであるサービスだけを読み、**抜粋にして**cloud へ渡す。
   * 意味づけは端末の LLM。`ASTRA_WORK_SYNC=off` で止められる。
   */
  const cloud = async (path: string, method: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path} failed with ${String(response.status)}`);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  };
  const workSync = new WorkSyncLoop({
    connectors: runtime,
    llm,
    ...(process.env['ASTRA_WORK_SYNC_GOOGLE_QUERY']
      ? { googleQuery: process.env['ASTRA_WORK_SYNC_GOOGLE_QUERY'] }
      : {}),
    ...(process.env['ASTRA_WORK_SYNC_MICROSOFT_QUERY']
      ? { microsoftQuery: process.env['ASTRA_WORK_SYNC_MICROSOFT_QUERY'] }
      : {}),
    push: async (batch) => {
      await cloud('/v1/work/artifacts', 'POST', batch);
    },
    // 続きは cloud の work_sync_state から（再起動しても 14 日分を読み直さない）。
    loadState: async () =>
      ((await cloud('/v1/work/sync', 'GET')) as { items: WorkSyncState[] }).items,
    attempt: async (source, attempt) => {
      await cloud(`/v1/work/sync/${source}/attempt`, 'POST', attempt);
    },
    onError: (source, error) =>
      logger.warn({ source, err: error.message }, 'work context sync failed for a source'),
  });
  if (process.env['ASTRA_WORK_SYNC'] !== 'off') {
    const minutes = Number(process.env['ASTRA_WORK_SYNC_INTERVAL_MIN']);
    const interval =
      Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : DEFAULT_SYNC_INTERVAL_MS;
    workSync.start(interval);
    const grantsTimer = setInterval(() => void refreshGrants(), interval);
    grantsTimer.unref?.();
  }

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down the local agent host');
    workSync.stop();
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
