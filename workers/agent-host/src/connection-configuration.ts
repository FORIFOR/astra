import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OauthEnv } from '@astra/oauth';

export const CONNECTION_CONFIGURATION_KEYS = new Set([
  'ASTRA_OAUTH_GOOGLE_CLIENT_ID',
  'ASTRA_OAUTH_GOOGLE_CLIENT_SECRET',
  'ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID',
  'ASTRA_OAUTH_GOOGLE_READ_CLIENT_SECRET',
  'ASTRA_OAUTH_GOOGLE_WRITE_CLIENT_ID',
  'ASTRA_OAUTH_GOOGLE_WRITE_CLIENT_SECRET',
  'ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID',
  'ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID',
]);

/** Native client settings only. User tokens stay in the OS credential store. */
export function connectionConfiguration(
  env: OauthEnv,
  platform = process.platform,
  home = homedir(),
): OauthEnv {
  const path =
    env['ASTRA_CONNECTIONS_CONFIG'] ??
    (platform === 'darwin' && !env['ASTRA_SECRET_STORE_FILE'] && !env['ASTRA_DATA_ROOT']
      ? join(home, 'Library/Application Support/Astra/connections.json')
      : undefined);
  let local: Record<string, string> = {};
  if (path) {
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        local = Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key, value]) => CONNECTION_CONFIGURATION_KEYS.has(key) && typeof value === 'string',
            )
            .map(([key, value]) => [key, (value as string).trim()]),
        );
      }
    } catch {
      /* Missing/invalid configuration stays unavailable; never log credentials. */
    }
  }
  return {
    ...local,
    ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
  };
}
