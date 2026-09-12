import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { expect, it } from 'vitest';
import { connectionConfiguration } from '../src/connection-configuration.js';

it('loads the native configuration for refresh without importing unrelated credentials', () => {
  const home = mkdtempSync(join(tmpdir(), 'genie-connections-'));
  try {
    const path = join(home, 'Library/Application Support/Astra/connections.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID: 'desktop',
        refreshToken: 'never-import',
      }),
    );
    const config = connectionConfiguration({}, 'darwin', home);
    expect(config['ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID']).toBe('desktop');
    expect(config['refreshToken']).toBeUndefined();
    expect(
      connectionConfiguration({ ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID: 'override' }, 'darwin', home)[
        'ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID'
      ],
    ).toBe('override');
    expect(
      connectionConfiguration({ ASTRA_SECRET_STORE_FILE: '/tmp/test' }, 'darwin', home)[
        'ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID'
      ],
    ).toBeUndefined();
    expect(
      connectionConfiguration(
        { ASTRA_CONNECTIONS_CONFIG: path, ASTRA_SECRET_STORE_FILE: '/tmp/test' },
        'darwin',
        home,
      )['ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID'],
    ).toBe('desktop');
    writeFileSync(path, 'invalid json');
    expect(connectionConfiguration({}, 'darwin', home)).toEqual({});
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
