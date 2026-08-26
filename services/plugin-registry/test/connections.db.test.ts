/**
 * Connector の接続状態。正本 §2.4・§21。
 *
 * 守りたいのは 2 つ:
 *   - 資格情報そのものを持たない
 *   - 繋がっていないことを、何も起きなかったことにしない
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, type DbHandle } from '@astra/db';
import { ConnectionService, looksLikeCredential } from '../src/connections.js';
import { PluginRegistryService } from '../src/service.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('looksLikeCredential', () => {
  it('recognises the shapes real tokens have', () => {
    // ここを緩めると、いずれ誰かがトークンをそのまま入れる
    for (const value of [
      'ya29.a0AfH6SMB-real-looking-token',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      'xoxb-1234-5678-abcdefg',
      'eyJhbGciOiJIUzI1NiJ9.payload',
      'x'.repeat(300),
    ]) {
      expect(looksLikeCredential(value), value.slice(0, 12)).toBe(true);
    }
  });

  it('lets an actual reference through', () => {
    for (const value of [
      'keychain:astra/gmail/primary',
      'secret-manager:projects/p/secrets/gmail',
      'vault://astra/connectors/gmail',
    ]) {
      expect(looksLikeCredential(value), value).toBe(false);
    }
  });
});

describe.skipIf(!url)('ConnectionService', () => {
  let db: DbHandle;
  let connections: ConnectionService;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const userId = uuidv7();
  const GMAIL = 'com.astra.gmail';

  const connect = (over: Record<string, unknown> = {}) =>
    connections.connect({
      tenantId,
      userId,
      pluginId: GMAIL,
      connectorId: 'gmail',
      credentialRef: 'keychain:astra/gmail/primary',
      grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'],
      ...over,
    } as never);

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-connections-test',
    });
    await withIdentity(db, async (tx) => {
      for (const id of [tenantId, otherTenantId]) {
        await tx.insertInto('tenants').values({ id, name: 'K', kind: 'personal' }).execute();
      }
      await tx
        .insertInto('users')
        .values({ id: userId, email: `k-${userId}@example.com`, display_name: 'K' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });

    const registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.seedBuiltins(path.join(repoRoot, 'plugins/builtin'));
    connections = new ConnectionService({ db });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('refuses to store the credential itself', async () => {
    await expect(connect({ credentialRef: 'ya29.a-real-looking-access-token' })).rejects.toThrow(
      /never the credential itself/,
    );
  });

  it('refuses a connector the plugin never declared', async () => {
    await expect(connect({ connectorId: 'not-declared' })).rejects.toThrow(/does not declare/);
  });

  it('keeps only the scopes that were actually declared', async () => {
    const connection = await connect({
      grantedScopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/drive',
      ],
    });
    expect(connection.grantedScopes).toEqual(['https://www.googleapis.com/auth/gmail.modify']);
  });

  it('never hands the reference back out', async () => {
    const connection = await connect();
    // 外へ出す理由が無い
    expect(JSON.stringify(connection)).not.toContain('keychain:');
  });

  it('refuses to use a connector that was never connected', async () => {
    // 繋がっていないことを、何も起きなかったことにしない
    await expect(connections.assertUsable(tenantId, 'com.astra.finder', 'finder')).rejects.toThrow(
      /not connected/,
    );
  });

  it('lets a live connection through', async () => {
    await connect();
    const usable = await connections.assertUsable(tenantId, GMAIL, 'gmail');
    expect(usable.state).toBe('CONNECTED');
  });

  it('does not call an expired connection connected', async () => {
    await connect({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await expect(connections.assertUsable(tenantId, GMAIL, 'gmail')).rejects.toThrow(/expired/);
  });

  it('stops working the moment it is disconnected', async () => {
    await connect();
    await connections.disconnect(tenantId, GMAIL, 'gmail');
    await expect(connections.assertUsable(tenantId, GMAIL, 'gmail')).rejects.toThrow(
      /not connected/,
    );
    expect(await connections.list(tenantId, GMAIL)).toEqual([]);
  });

  it('replaces a connection instead of stacking two', async () => {
    await connect({ accountLabel: '一つ目' });
    await connect({ accountLabel: '二つ目' });
    const live = await connections.list(tenantId, GMAIL);
    expect(live).toHaveLength(1);
    expect(live[0]!.accountLabel).toBe('二つ目');
  });

  it('records a failure rather than pretending to be connected', async () => {
    await connect();
    await connections.markUnusable(tenantId, GMAIL, 'gmail', 'ERROR', 'refresh failed');
    await expect(connections.assertUsable(tenantId, GMAIL, 'gmail')).rejects.toThrow(/error/);
  });

  it('shows another tenant nothing', async () => {
    await connect();
    expect(await connections.list(otherTenantId, GMAIL)).toEqual([]);
  });
});
