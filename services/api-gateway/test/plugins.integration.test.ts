/**
 * Plugin カタログと install。実装仕様 §9、受け入れテスト AC-12。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type ApiError,
  type PluginCatalogEntry,
  type PluginInstall,
  type TokenResponse,
} from '@astra/contracts';
import { withTenant } from '@astra/db';
import { readAuditChain, verifyAuditChain } from '@astra/telemetry';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('plugin catalog', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };
  let tenantId: string;

  const catalog = async (): Promise<PluginCatalogEntry[]> => {
    const res = await app.inject({ method: 'GET', url: '/v1/plugins/catalog', headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json<{ items: PluginCatalogEntry[] }>().items;
  };

  beforeAll(async () => {
    const tokens = await makeTokens();
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens,
      seedPlugins: true,
    });
    app = harness.app;

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `p-${uuidv7()}@example.com`, display_name: 'P' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    tenantId = me.json<{ tenant: { id: string } }>().tenant.id;
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe('seeding', () => {
    it('lists every bundled plugin (AC-12)', async () => {
      const items = await catalog();
      // 同梱の分だけを見る。**完全一致では見ない**:
      // 同じ DB を使う別スイートが publish した plugin で壊れる。
      const bundled = items.map((p) => p.id as string).filter((id) => id.startsWith('com.astra.'));
      expect(bundled.sort()).toEqual([
        'com.astra.finder',
        'com.astra.gmail',
        'com.astra.google-calendar',
        'com.astra.meeting',
        'com.astra.research',
        'com.astra.sales-crm',
      ]);
    });

    it('shows what each plugin can reach before installing it', async () => {
      // 正本 §2.4 の detail page 必須表示項目
      const gmail = (await catalog()).find((p) => p.id === 'com.astra.gmail')!;
      expect(gmail.data_accessed.length).toBeGreaterThan(0);
      expect(gmail.permissions).toContain('email.send');
      expect(gmail.tool_count).toBe(5);
      expect(gmail.execution_surfaces).toEqual(['cloud']);
      expect(gmail.signature_state).toBe('BUILTIN_TRUSTED');
      expect(gmail.installed).toBe(false);
    });

    it('marks the core agents as non-removable', async () => {
      for (const id of ['com.astra.meeting', 'com.astra.research']) {
        const entry = (await catalog()).find((p) => p.id === id)!;
        expect(entry.builtin).toBe(true);
        expect(entry.removable).toBe(false);
      }
    });

    it('is idempotent across restarts', async () => {
      const before = await catalog();
      await harness.registry.seedBuiltins(
        new URL('../../../plugins/builtin', import.meta.url).pathname,
      );
      expect(await catalog()).toEqual(before);
    });
  });

  describe('install', () => {
    it('records granted scopes and leaves the rest denied', async () => {
      // 正本 §3 Step 5: 一度に全 permission を要求しない
      const res = await app.inject({
        method: 'POST',
        url: '/v1/plugins/com.astra.gmail/install',
        headers: auth,
        payload: { version: '0.1.0', granted_scopes: ['email.read'] },
      });
      expect(res.statusCode).toBe(201);
      const install = res.json<PluginInstall>();
      expect(install.granted_scopes).toEqual(['email.read']);
      expect(install.denied_scopes).toEqual(
        expect.arrayContaining(['email.send', 'email.draft', 'contacts.read']),
      );

      const entry = (await catalog()).find((p) => p.id === 'com.astra.gmail')!;
      expect(entry.installed).toBe(true);
      expect(entry.installed_version).toBe('0.1.0');
    });

    it('ignores scopes the plugin never declared', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/plugins/com.astra.finder/install',
        headers: auth,
        payload: { version: '0.1.0', granted_scopes: ['files.read', 'crm.write'] },
      });
      const install = res.json<PluginInstall>();
      expect(install.granted_scopes).toEqual(['files.read']);
      expect(install.granted_scopes).not.toContain('crm.write');
    });

    it('refuses an unknown plugin or version', async () => {
      const unknown = await app.inject({
        method: 'POST',
        url: '/v1/plugins/com.example.nope/install',
        headers: auth,
        payload: { version: '0.1.0' },
      });
      expect(unknown.statusCode).toBe(404);

      const badVersion = await app.inject({
        method: 'POST',
        url: '/v1/plugins/com.astra.gmail/install',
        headers: auth,
        payload: { version: '9.9.9' },
      });
      expect(badVersion.statusCode).toBe(404);
      expect(badVersion.json<ApiError>().error.code).toBe('plugin.not_found');
    });

    it('records the install and the grant in the audit chain', async () => {
      const chain = await withTenant(harness.db, tenantId, (tx) => readAuditChain(tx, tenantId));
      const actions = chain.map((r) => r.action);
      expect(actions).toContain('plugin.install');
      expect(actions).toContain('plugin.permission.grant');
      expect(await verifyAuditChain(chain)).toEqual([]);
    });
  });

  describe('uninstall', () => {
    it('removes an optional connector', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/plugins/com.astra.finder',
        headers: auth,
      });
      expect(res.statusCode).toBe(204);
      const entry = (await catalog()).find((p) => p.id === 'com.astra.finder')!;
      expect(entry.installed).toBe(false);
    });

    it('refuses to remove a built-in capability', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/plugins/com.astra.meeting',
        headers: auth,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<ApiError>().error.code).toBe('plugin.not_removable');
    });

    it('refuses to remove something that was never installed', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/plugins/com.astra.google-calendar',
        headers: auth,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it('shows another tenant the same catalog with nothing installed', async () => {
      const other = await app.inject({
        method: 'POST',
        url: '/v1/auth/dev/token',
        payload: { email: `q-${uuidv7()}@example.com`, display_name: 'Q' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/plugins/catalog',
        headers: { authorization: `Bearer ${other.json<TokenResponse>().access_token}` },
      });
      const items = res.json<{ items: PluginCatalogEntry[] }>().items;
      // 同梱の 5 つが見えていること。件数で見ると、
      // ほかのテストが publish した plugin で壊れる。
      const ids = new Set(items.map((p) => p.id));
      for (const id of [
        'com.astra.research',
        'com.astra.meeting',
        'com.astra.google-calendar',
        'com.astra.finder',
        'com.astra.gmail',
      ]) {
        expect(ids.has(id as never), id).toBe(true);
      }
      expect(items.every((p) => !p.installed)).toBe(true);
    });
  });
});
