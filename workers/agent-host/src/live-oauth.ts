/** Dedicated live-test grants. Requested scopes are never evidence of granted scopes. */
import { providerConfig, refresh, TokenStore, type TokenSet } from '@astra/oauth';
export type LiveProvider = 'google' | 'microsoft';
export type LiveGrant = 'seed' | 'read' | 'write';
export const LIVE_SCOPES = {
  google: {
    read: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    write: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  },
  microsoft: {
    read: ['Mail.Read', 'Calendars.Read', 'User.Read'],
    write: ['Mail.Send', 'User.Read'],
  },
} as const;

export function assertLiveScopes(
  tokens: TokenSet,
  required: readonly string[],
  grant: LiveGrant,
): void {
  const granted = new Set(tokens.grantedScopes);
  if (required.some((scope) => !granted.has(scope)))
    throw new Error(`${grant}: provider did not attest all required scopes`);
  const allowed = new Set<string>([
    ...required,
    'openid',
    'email',
    'profile',
    'offline_access',
    'User.Read',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ]);
  if (tokens.grantedScopes.some((scope) => !allowed.has(scope)))
    throw new Error(`${grant}: token contains non-${grant} scopes`);
}

export async function liveTokens(
  provider: LiveProvider,
  scopes: readonly string[],
  grant: LiveGrant = 'seed',
): Promise<TokenSet> {
  const key = provider === 'google' ? 'GOOGLE' : 'MS';
  const alias = provider.toUpperCase();
  const suffix = grant === 'seed' ? '' : `_${grant.toUpperCase()}`;
  const clientId =
    process.env[`ASTRA_TEST_${key}${suffix}_CLIENT_ID`] ??
    process.env[`ASTRA_TEST_${alias}${suffix}_CLIENT_ID`] ??
    process.env[`ASTRA_TEST_${key}_CLIENT_ID`] ??
    process.env[`ASTRA_TEST_${alias}_CLIENT_ID`];
  const workerClient =
    process.env[`ASTRA_TEST_${key}_READ_CLIENT_ID`] ??
    process.env[`ASTRA_TEST_${alias}_READ_CLIENT_ID`] ??
    process.env[`ASTRA_TEST_${key}_CLIENT_ID`] ??
    process.env[`ASTRA_TEST_${alias}_CLIENT_ID`];
  if (provider === 'google' && grant === 'write' && clientId !== workerClient)
    throw new Error('worker read/write grants must belong to the same OAuth client');
  if (provider === 'microsoft') {
    const seedClient =
      process.env['ASTRA_TEST_MS_CLIENT_ID'] ?? process.env['ASTRA_TEST_MICROSOFT_CLIENT_ID'];
    const readClient =
      process.env['ASTRA_TEST_MS_READ_CLIENT_ID'] ??
      process.env['ASTRA_TEST_MICROSOFT_READ_CLIENT_ID'];
    const writeClient =
      process.env['ASTRA_TEST_MS_WRITE_CLIENT_ID'] ??
      process.env['ASTRA_TEST_MICROSOFT_WRITE_CLIENT_ID'];
    const configured = [seedClient, readClient, writeClient].filter(Boolean);
    if (
      new Set(configured).size !== configured.length ||
      (grant === 'read' && !readClient) ||
      (grant === 'write' && !writeClient)
    )
      throw new Error('microsoft: seed/read/write require distinct OAuth clients');
  }
  const refreshToken =
    process.env[`ASTRA_TEST_${key}${suffix}_REFRESH_TOKEN`] ??
    process.env[`ASTRA_TEST_${alias}${suffix}_REFRESH_TOKEN`];
  if (!clientId || !refreshToken)
    throw new Error(`${provider}: dedicated ${grant} identity grant not provisioned`);
  const clientSecret =
    process.env[`ASTRA_TEST_${key}${suffix}_CLIENT_SECRET`] ??
    process.env[`ASTRA_TEST_${alias}${suffix}_CLIENT_SECRET`] ??
    (clientId === process.env[`ASTRA_TEST_${key}_CLIENT_ID`]
      ? process.env[`ASTRA_TEST_${key}_CLIENT_SECRET`]
      : undefined);
  const config = providerConfig(provider, scopes, {
    [`ASTRA_OAUTH_${alias}_CLIENT_ID`]: clientId,
    ...(clientSecret ? { [`ASTRA_OAUTH_${alias}_CLIENT_SECRET`]: clientSecret } : {}),
  });
  if (!config) throw new Error(`${provider}: no provider config`);
  const tokens = await refresh(
    { ...config, redirectUri: 'http://127.0.0.1:0/callback' },
    refreshToken,
    fetch,
  );
  assertLiveScopes(
    tokens,
    scopes.filter((scope) => scope !== 'offline_access'),
    grant,
  );
  return tokens;
}

export async function saveLiveReadGrant(
  provider: LiveProvider,
  store: TokenStore,
): Promise<TokenSet> {
  const tokens = await liveTokens(provider, LIVE_SCOPES[provider].read, 'read');
  if (provider === 'google') {
    await store.save('com.astra.gmail', 'gmail', tokens);
    await store.save('com.astra.google-calendar', 'google-calendar', tokens);
  } else await store.save('com.astra.outlook', 'outlook', tokens);
  return tokens;
}

/** Called only after the approval is observed, immediately before approving the send. */
export async function saveLiveWriteGrant(
  provider: LiveProvider,
  store: TokenStore,
  expectedIdentity: string,
): Promise<void> {
  const tokens = await liveTokens(provider, LIVE_SCOPES[provider].write, 'write');
  const response = await fetch(
    provider === 'google'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      : 'https://graph.microsoft.com/v1.0/me',
    { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  );
  if (!response.ok) throw new Error('write identity verification failed');
  const identity = (await response.json()) as {
    emailAddress?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const email = identity.emailAddress ?? identity.mail ?? identity.userPrincipalName;
  if (!email || email.toLowerCase() !== expectedIdentity.toLowerCase())
    throw new Error('write and seed identities differ');
  await store.save(
    provider === 'google' ? 'com.astra.gmail' : 'com.astra.outlook',
    provider === 'google' ? 'gmail-actions' : 'outlook-actions',
    tokens,
  );
}
