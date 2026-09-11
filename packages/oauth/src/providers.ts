/**
 * 提供者ごとの設定。正本 §2.4・§21。
 *
 * **client_id を同梱しない。**実行時に与える。
 * 与えられていない提供者は「繋げない」と答える。
 * **繋げないことを、繋いだつもりにさせない。**
 */
import type { ProviderConfig } from './flow.js';

/** 対応している提供者。ここに無いものへは繋がない。 */
export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number];

/** 提供者ごとの、動かない部分（端点と既定の scope）。 */
const ENDPOINTS: Readonly<
  Record<OauthProvider, { authorizeUrl: string; tokenUrl: string; extra?: Record<string, string> }>
> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // refresh token を貰うために要る。無いと 1 時間で黙って切れる。
    extra: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    extra: { prompt: 'consent' },
  },
};

/** 環境変数の名前。1 箇所で決める。 */
export function clientIdVar(provider: OauthProvider): string {
  return `ASTRA_OAUTH_${provider.toUpperCase()}_CLIENT_ID`;
}

export type OauthEnv = Readonly<Record<string, string | undefined>>;

/**
 * 設定されている提供者だけを返す。
 *
 * **無いものを既定値で埋めない。**空の client_id で始めると、
 * 提供者の画面で意味の分からない失敗になる。
 */
export function configuredProviders(env: OauthEnv): OauthProvider[] {
  return OAUTH_PROVIDERS.filter((provider) => {
    const value = env[clientIdVar(provider)];
    return typeof value === 'string' && value.length > 0;
  });
}

/**
 * 繋ぐための設定を組む。**未設定なら null。**
 * 例外にしないのは、画面が「繋げません」と出せるようにするため。
 */
export function providerConfig(
  provider: OauthProvider,
  scopes: readonly string[],
  env: OauthEnv,
): Omit<ProviderConfig, 'redirectUri'> | null {
  const clientId = env[clientIdVar(provider)];
  if (!clientId) return null;

  const endpoints = ENDPOINTS[provider];
  return {
    provider,
    authorizeUrl: endpoints.authorizeUrl,
    tokenUrl: endpoints.tokenUrl,
    clientId,
    scopes,
    ...(endpoints.extra ? { extraAuthorizeParams: endpoints.extra } : {}),
    // Google Desktop clients require this value at the token endpoint.
    // It does not authenticate a native app; PKCE remains required.
    ...(provider === 'google' && env['ASTRA_OAUTH_GOOGLE_CLIENT_SECRET']
      ? { clientSecret: env['ASTRA_OAUTH_GOOGLE_CLIENT_SECRET'] }
      : {}),
  };
}

/** Microsoft refresh tokens cover consent for a client, so read/write need distinct clients. */
export function connectorProviderConfig(
  provider: OauthProvider,
  connectorId: string,
  scopes: readonly string[],
  env: OauthEnv,
): Omit<ProviderConfig, 'redirectUri'> | null {
  if (provider !== 'microsoft') return providerConfig(provider, scopes, env);
  const read = env['ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID'];
  const write = env['ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID'];
  if (read && write && read === write) return null;
  const writes = connectorId.endsWith('-actions');
  const clientId = writes ? write : read;
  if (!clientId || scopes.length === 0) return null;
  const identity = ['openid', 'profile', 'email', 'offline_access', 'user.read'];
  const allowed = new Set([
    ...identity,
    ...(writes ? ['mail.send'] : ['mail.read', 'calendars.read', 'tasks.read']),
  ]);
  if (
    scopes.some(
      (s) => !allowed.has(s.replace(/^https:\/\/graph.microsoft.com\//i, '').toLowerCase()),
    )
  )
    return null;
  return providerConfig(provider, scopes, { ...env, ASTRA_OAUTH_MICROSOFT_CLIENT_ID: clientId });
}

/** どの提供者が繋げないか。設定名まで含めて言う。 */
export function unconfiguredProviders(
  env: OauthEnv,
): { provider: OauthProvider; setting: string }[] {
  const ready = new Set(configuredProviders(env));
  return OAUTH_PROVIDERS.filter((p) => !ready.has(p)).map((provider) => ({
    provider,
    setting: clientIdVar(provider),
  }));
}
