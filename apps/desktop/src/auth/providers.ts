/**
 * 提供者（Google / Apple / LINE）でサインインする。実装仕様 §4.3、正本 §21。
 *
 * deepnote-desktop の auth/{google,apple,line}.rs を Astra の形にしたもの。
 * 違いは 2 つ:
 *
 *   - Firebase を挟まない。提供者の **ID トークンだけ**を gateway に渡し、
 *     gateway が提供者の鍵で検証して Astra のトークンを返す。
 *   - Google は端末の PKCE loopback（`@astra/oauth`）で直接。**refresh token は
 *     求めない**（サインインに要らない。connector 用の token は別の場所で Keychain へ）。
 *
 * Apple の web flow と LINE は、提供者が https の折り返し先や channel secret を
 * 要求するので gateway の relay を経由する。relay は ID トークンを loopback へ返すだけで、
 * サインインそのものは常に `/v1/auth/idp/token` を通る。
 */
import {
  acceptCallback,
  beginAuthorization,
  exchangeCode,
  type ProviderConfig,
} from '@astra/oauth';
import type { AstraClient } from '@astra/api-client';
import type { AuthProvidersResponse, IdentityProvider, TokenResponse } from '@astra/contracts';
import { oauthCallback } from '../host/tauri.js';

export type ProviderEntry = AuthProvidersResponse['providers'][number];

export const PROVIDER_LABEL: Record<IdentityProvider, string> = {
  google: 'Google で続ける',
  apple: 'Apple で続ける',
  line: 'LINE で続ける',
};

/** 提供者ごとの、利用者に見せる失敗理由。§21: 影響と次の行動。 */
export class SignInAbortedError extends Error {
  constructor(message = 'サインインを途中でやめました') {
    super(message);
    this.name = 'SignInAbortedError';
  }
}

export interface ProviderSignInDeps {
  readonly client: AstraClient;
  /** gateway の場所。relay の URL を組むのに使う。 */
  readonly baseUrl: string;
  readonly openExternal: (url: string) => Promise<void>;
  readonly now?: () => number;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly deviceName?: string;
  readonly appVersion?: string;
  /** relay の state。テストで固定する。 */
  readonly randomState?: () => string;
}

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const GOOGLE_SIGN_IN: Omit<ProviderConfig, 'redirectUri' | 'clientId'> = {
  provider: 'google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  // openid が無いと id_token が返らない。offline access は求めない（refresh token を持たない）
  scopes: ['openid', 'email', 'profile'],
  extraAuthorizeParams: { prompt: 'select_account' },
};

/**
 * Google。端末の loopback で PKCE。deepnote の google.rs と同じ順番:
 * 待ち受け → authorize URL → ブラウザ → 折り返し → code 交換 → id_token。
 */
async function signInGoogle(
  entry: ProviderEntry,
  deps: ProviderSignInDeps,
): Promise<TokenResponse> {
  if (!entry.client_id) throw new Error('Google の client id が設定されていません');
  const now = deps.now ?? Date.now;
  const listening = await oauthCallback.listen();
  let idToken: string | null;
  try {
    const config: ProviderConfig = {
      ...GOOGLE_SIGN_IN,
      clientId: entry.client_id,
      redirectUri: listening.redirectUri,
    };
    const { url, pending } = await beginAuthorization(config, now);
    await deps.openExternal(url);
    const params = await oauthCallback.await();
    if (params.error === 'access_denied') throw new SignInAbortedError();
    const { code } = acceptCallback(pending, params, now);
    const tokens = await exchangeCode(
      pending,
      code,
      (deps.fetchImpl ?? globalThis.fetch) as never,
      now,
    );
    idToken = tokens.idToken;
  } catch (error) {
    await oauthCallback.cancel();
    throw error;
  }
  if (!idToken) throw new Error('Google から ID トークンが返りませんでした');
  return deps.client.signInWithIdp({
    provider: 'google',
    id_token: idToken,
    nonce: null,
    display_name: null,
    device_name: deps.deviceName ?? 'Mac',
    platform: 'macos',
    app_version: deps.appVersion ?? '0.1.0',
  });
}

/**
 * Apple（web）/ LINE。gateway の relay を経由する。deepnote の apple.rs / line.rs の
 * `{api}/auth/{provider}/desktop?port=&state=` と同じ契約。
 */
async function signInViaRelay(
  provider: 'apple' | 'line',
  entry: ProviderEntry,
  deps: ProviderSignInDeps,
): Promise<TokenResponse> {
  if (!entry.relay_path) throw new Error(`${PROVIDER_LABEL[provider]} は設定されていません`);
  const state = (deps.randomState ?? randomState)();
  const listening = await oauthCallback.listen();
  let idToken: string;
  let displayName: string | null = null;
  try {
    const url = new URL(entry.relay_path, deps.baseUrl);
    url.searchParams.set('port', String(listening.port));
    url.searchParams.set('state', state);
    await deps.openExternal(url.toString());
    const params = await oauthCallback.await();
    if (params.error === 'access_denied') throw new SignInAbortedError();
    if (params.error) throw new Error(params.error);
    // state が違えば、開いた覚えの無い折り返し。受け取らない
    if (params.state !== state) throw new Error('折り返しの state が一致しません');
    if (!params.id_token) throw new Error('ID トークンが返りませんでした');
    idToken = params.id_token;
    displayName = params.display_name ?? null;
  } catch (error) {
    await oauthCallback.cancel();
    throw error;
  }
  return deps.client.signInWithIdp({
    provider,
    id_token: idToken,
    nonce: null,
    display_name: displayName,
    device_name: deps.deviceName ?? 'Mac',
    platform: 'macos',
    app_version: deps.appVersion ?? '0.1.0',
  });
}

export async function signInWithProvider(
  entry: ProviderEntry,
  deps: ProviderSignInDeps,
): Promise<TokenResponse> {
  if (!entry.configured) {
    throw new Error(`${PROVIDER_LABEL[entry.id]} は、この環境ではまだ設定されていません`);
  }
  switch (entry.id) {
    case 'google':
      return signInGoogle(entry, deps);
    case 'apple':
    case 'line':
      return signInViaRelay(entry.id, entry, deps);
  }
}
