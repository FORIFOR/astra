/**
 * connector を繋ぐ。正本 §21・§2.4。
 *
 * 順番はこうでなければならない:
 *
 *   1. 待ち受けを開く（port は OS が選ぶ）
 *   2. 折り返し先を含めて authorize URL を組む
 *   3. ブラウザを開く
 *   4. 折り返しを 1 回だけ受け取る
 *   5. code を交換する
 *   6. トークンを keychain へ置き、**参照だけ**をサーバへ渡す
 *
 * **5 と 6 を飛ばして値をサーバへ送らない。**
 * 送ってしまえば、あとから消しても「一度は置かれた」ことは戻らない。
 */
import {
  TokenStore,
  acceptCallback,
  beginAuthorization,
  exchangeCode,
  type ProviderConfig,
  type TokenSet,
} from '@astra/oauth';
import type { AstraClient } from '@astra/api-client';
import { oauthCallback, secrets } from '../host/tauri.js';

/** 提供者ごとの設定。**client_id は実行時に与える。**同梱しない。 */
export interface ConnectorTarget {
  readonly pluginId: string;
  readonly connectorId: string;
  /** redirect_uri は待ち受けが決めるので、ここには含めない。 */
  readonly provider: Omit<ProviderConfig, 'redirectUri'>;
  readonly accountLabel?: string | null;
}

export interface ConnectDeps {
  readonly client: AstraClient;
  /** ブラウザを開く。**アプリ内の webview では開かない**（RFC 8252 §8.12）。 */
  openExternal(url: string): Promise<void>;
  readonly now?: () => number;
  readonly fetchImpl?: typeof globalThis.fetch;
}

export interface ConnectResult {
  readonly credentialRef: string;
  readonly grantedScopes: readonly string[];
  readonly expiresAt: string | null;
}

export async function connectConnector(
  target: ConnectorTarget,
  deps: ConnectDeps,
): Promise<ConnectResult> {
  const now = deps.now ?? Date.now;

  // 1. 待ち受けを先に開く。URL を組んでから開くと、port が決まらない。
  const listening = await oauthCallback.listen();

  let tokens: TokenSet;
  try {
    const config: ProviderConfig = { ...target.provider, redirectUri: listening.redirectUri };
    const { url, pending } = await beginAuthorization(config, now);

    await deps.openExternal(url);

    const params = await oauthCallback.await();
    const { code } = acceptCallback(pending, params, now);

    tokens = await exchangeCode(pending, code, (deps.fetchImpl ?? globalThis.fetch) as never, now);
  } catch (error) {
    // 途中で終わったら待ち受けを閉じる。開きっぱなしにしない。
    await oauthCallback.cancel();
    throw error;
  }

  // 6. keychain へ置いて、参照だけをサーバへ渡す
  const store = new TokenStore(secrets);
  const ref = await store.save(target.pluginId, target.connectorId, tokens);

  try {
    await deps.client.connectConnector(target.pluginId, {
      connector_id: target.connectorId,
      credential_ref: ref,
      granted_scopes: [...tokens.grantedScopes],
      account_label: target.accountLabel ?? null,
      expires_at: tokens.expiresAt,
    });
  } catch (error) {
    /*
     * サーバに残らなかったなら、端末にも残さない。
     * **片方だけ残ると、「繋がっていないのにトークンがある」状態になる。**
     */
    await store.forget(ref);
    throw error;
  }

  return {
    credentialRef: ref,
    grantedScopes: tokens.grantedScopes,
    expiresAt: tokens.expiresAt,
  };
}
