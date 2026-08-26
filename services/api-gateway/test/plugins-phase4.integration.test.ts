/**
 * Plugin Platform。Phase 4 実装仕様 §5。AC4-1〜AC4-12。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type DashboardView, type TokenResponse } from '@astra/contracts';
import { composeDataSources } from '@astra/service-plugin-registry';
import {
  generatePublisherKeyPair,
  loadManifest,
  signManifest,
  type PluginAsset,
} from '@astra/plugin-sdk';
import { withSystem } from '@astra/db';
import { sha256Hex } from '@astra/contracts';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('the plugin platform', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };
  let tenantId: string;

  const install = (pluginId: string, version: string, scopes: string[] = []) =>
    app.inject({
      method: 'POST',
      url: `/v1/plugins/${pluginId}/install`,
      headers: auth,
      payload: { version, granted_scopes: scopes },
    });

  beforeAll(async () => {
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens: await makeTokens(),
      seedPlugins: true,
      dataSources: composeDataSources({
        // 所有サービスの代わり。ここで見たいのは解決の経路であって中身ではない。
        research_runs: async () => ({ kind: 'count', value: 7 }),
        research_contradicted: async () => ({ kind: 'count', value: 2 }),
        research_by_confidence: async () => ({
          kind: 'series',
          points: [{ label: 'low', value: 2 }],
        }),
        research_recent: async () => ({ kind: 'rows', columns: ['質問'], rows: [['売上は']] }),
      }),
    });
    app = harness.app;

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `pl-${uuidv7()}@example.com`, display_name: 'PL' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    tenantId = me.json<{ tenant: { id: string } }>().tenant.id;
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe('publishing (AC4-1)', () => {
    it('loaded the bundled plugins together with the files they declare', async () => {
      // 宣言と実体がずれた plugin は seed で落ちる。ここまで来ていれば揃っている。
      const asset = await harness.registry.asset(
        'com.astra.research',
        '0.1.0',
        'dashboards/research-runs.json',
      );
      expect(asset).not.toBeNull();
      expect(JSON.parse(asset!.toString('utf8')).id).toBe('research-runs');
    });
  });

  describe('installing (AC4-2, AC4-3, AC4-6)', () => {
    it('shows what will be accessed before anything is granted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/plugins/com.astra.research',
        headers: auth,
      });
      const detail = res.json<{
        permissions: string[];
        data_accessed: string[];
        execution_surfaces: string[];
        installed: boolean;
      }>();
      // §11.1 の必須項目。押す前に見えていなければ同意にならない。
      expect(detail.permissions.length).toBeGreaterThan(0);
      expect(detail.data_accessed.length).toBeGreaterThan(0);
      expect(detail.execution_surfaces).toContain('cloud');
      expect(detail.installed).toBe(false);
    });

    it('adds the dashboard the plugin brought, with no code change', async () => {
      expect(
        (await app.inject({ method: 'GET', url: '/v1/dashboards', headers: auth })).json(),
      ).toEqual({ items: [] });

      expect((await install('com.astra.research', '0.1.0', ['web.search'])).statusCode).toBe(201);

      const res = await app.inject({ method: 'GET', url: '/v1/dashboards', headers: auth });
      const { items } = res.json<{ items: { plugin_id: string; id: string }[] }>();
      expect(items).toEqual([
        expect.objectContaining({ plugin_id: 'com.astra.research', id: 'research-runs' }),
      ]);
    });

    it('serves the dashboard with its data resolved', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/plugins/com.astra.research/dashboards/research-runs',
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      const view = res.json<DashboardView>();
      expect(view.schema.items[0]!.type).toBe('metric');
      expect(view.data['research.total']).toEqual({ kind: 'count', value: 7 });
    });
  });

  describe('permissions (AC4-7)', () => {
    it('says no to a scope that was never granted', async () => {
      // install 画面で見せるだけでは足りない
      expect(await harness.registry.isPermitted(tenantId, 'com.astra.research', 'web.search')).toBe(
        true,
      );
      expect(await harness.registry.isPermitted(tenantId, 'com.astra.research', 'web.fetch')).toBe(
        false,
      );
    });
  });

  describe('unresolvable data (AC4-5)', () => {
    it('says why rather than drawing a zero', async () => {
      const isolated = await makeTestApp({
        db: harness.db,
        dbConfig: testDbConfig(url!, identityUrl),
        tokens: await makeTokens(),
        seedPlugins: true,
        // データ源をひとつも渡さない
      });
      const issued = await isolated.app.inject({
        method: 'POST',
        url: '/v1/auth/dev/token',
        payload: { email: `nd-${uuidv7()}@example.com`, display_name: 'ND' },
      });
      const headers = {
        authorization: `Bearer ${issued.json<TokenResponse>().access_token}`,
      };
      await isolated.app.inject({
        method: 'POST',
        url: '/v1/plugins/com.astra.research/install',
        headers,
        payload: { version: '0.1.0', granted_scopes: [] },
      });

      const res = await isolated.app.inject({
        method: 'GET',
        url: '/v1/plugins/com.astra.research/dashboards/research-runs',
        headers,
      });
      const view = res.json<DashboardView>();
      const value = view.data['research.total'];
      // 0 で描くと「無い」と「壊れている」が区別できない
      expect(value).toMatchObject({ kind: 'unavailable' });
      expect((value as { reason: string }).reason).toContain('research_runs');
      await isolated.close();
    });
  });

  describe('compatibility (AC4-8)', () => {
    it('refuses a plugin that needs a newer core', async () => {
      const res = await install('com.astra.research', '9.9.9');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('a core capability', () => {
    it('cannot be uninstalled at all', async () => {
      // 中核の Agent を消せてしまうと、4 タブの製品が成り立たなくなる
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/plugins/com.astra.research',
        headers: auth,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('a third-party plugin (AC4-1, AC4-9, AC4-10, AC4-11)', () => {
    const publisher = generatePublisherKeyPair();
    const PLUGIN_ID = 'com.acme.pipeline';

    const dashboardJson = (id: string) =>
      Buffer.from(
        JSON.stringify({
          id,
          title: 'パイプライン',
          items: [{ type: 'metric', title: '件数', bind: 'acme.total' }],
        }),
      );

    const manifestFor = async (version: string) => {
      const base = {
        id: PLUGIN_ID,
        name: 'Pipeline',
        version,
        publisher: 'acme',
        verified: false,
        min_core_version: '0.1.0',
        category: 'domain-agent',
        compliance_profile: 'GENERAL',
        execution_surfaces: ['cloud'],
        permissions: ['artifacts.read'],
        data_accessed: ['Opportunities the user can already see'],
        dashboards: [{ id: 'pipeline', schema: 'dashboards/pipeline.json' }],
        data_sources: [{ id: 'acme.total', kind: 'count', query: 'research_runs' }],
      };
      const unsigned = await loadManifest(base, 'test');
      const signature = signManifest(unsigned.canonical, publisher.privateKey);
      return loadManifest({ ...base, signature }, 'test');
    };

    const assets = async (
      path = 'dashboards/pipeline.json',
      id = 'pipeline',
    ): Promise<PluginAsset[]> => {
      const content = dashboardJson(id);
      return [{ path, kind: 'dashboard', content, sha256: await sha256Hex(content) }];
    };

    beforeAll(async () => {
      await withSystem(harness.db, (tx) =>
        tx
          .insertInto('plugin_publishers')
          .values({
            id: 'acme',
            display_name: 'Acme',
            public_key: publisher.publicKey,
            verified: false,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute(),
      );
    });

    it('AC4-1: refuses an asset whose checksum does not match its content', async () => {
      // 申告されたハッシュを信用しない
      const manifest = await manifestFor('1.0.0');
      const [good] = await assets();
      await expect(
        harness.registry.publish(manifest, [{ ...good!, sha256: 'a'.repeat(64) }]),
      ).rejects.toThrow(/checksum/);
    });

    it('AC4-1: refuses to publish when a declared file is not provided', async () => {
      const manifest = await manifestFor('1.0.0');
      await expect(harness.registry.publish(manifest, [])).rejects.toThrow(
        /declares "dashboards\/pipeline.json"/,
      );
    });

    it('AC4-1: refuses a dashboard whose id disagrees with the manifest', async () => {
      const manifest = await manifestFor('1.0.0');
      await expect(
        harness.registry.publish(
          manifest,
          await assets('dashboards/pipeline.json', 'something-else'),
        ),
      ).rejects.toThrow(/manifest declares "pipeline"/);
    });

    it('installs, then updates forward only', async () => {
      await harness.registry.publish(await manifestFor('1.0.0'), await assets());
      await harness.registry.publish(await manifestFor('1.1.0'), await assets());

      expect((await install(PLUGIN_ID, '1.0.0', ['artifacts.read'])).statusCode).toBe(201);

      // 下げるのは rollback の仕事。update で下がると「上げたつもりが下がっていた」が起きる
      const backwards = await app.inject({
        method: 'POST',
        url: `/v1/plugins/${PLUGIN_ID}/update`,
        headers: auth,
        payload: { version: '1.0.0' },
      });
      expect(backwards.statusCode).toBe(409);

      const forward = await app.inject({
        method: 'POST',
        url: `/v1/plugins/${PLUGIN_ID}/update`,
        headers: auth,
        payload: { version: '1.1.0' },
      });
      expect(forward.statusCode).toBe(200);
      expect(forward.json<{ version: string }>().version).toBe('1.1.0');
      // minor 更新では同意を取り直さない
      expect(await harness.registry.isPermitted(tenantId, PLUGIN_ID, 'artifacts.read')).toBe(true);
    });

    it('AC4-10: rolls back to the version it came from, once', async () => {
      const back = await app.inject({
        method: 'POST',
        url: `/v1/plugins/${PLUGIN_ID}/rollback`,
        headers: auth,
      });
      expect(back.statusCode).toBe(200);
      expect(back.json<{ version: string }>().version).toBe('1.0.0');

      // 戻る先はもう無い。往復し続けられない。
      const again = await app.inject({
        method: 'POST',
        url: `/v1/plugins/${PLUGIN_ID}/rollback`,
        headers: auth,
      });
      expect(again.statusCode).toBe(404);
    });

    it('AC4-11: uninstalling takes its dashboard away', async () => {
      const before = await app.inject({ method: 'GET', url: '/v1/dashboards', headers: auth });
      expect(
        before.json<{ items: { plugin_id: string }[] }>().items.map((d) => d.plugin_id),
      ).toContain(PLUGIN_ID);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/plugins/${PLUGIN_ID}`,
        headers: auth,
      });
      expect(removed.statusCode).toBe(204);

      const after = await app.inject({ method: 'GET', url: '/v1/dashboards', headers: auth });
      expect(
        after.json<{ items: { plugin_id: string }[] }>().items.map((d) => d.plugin_id),
      ).not.toContain(PLUGIN_ID);
    });
  });

  describe('another tenant (AC4-12)', () => {
    it('does not see this tenant’s installs', async () => {
      await install('com.astra.research', '0.1.0', ['web.search']);
      const outsider = await app.inject({
        method: 'POST',
        url: '/v1/auth/dev/token',
        payload: { email: `ot-${uuidv7()}@example.com`, display_name: 'OT' },
      });
      const headers = {
        authorization: `Bearer ${outsider.json<TokenResponse>().access_token}`,
      };
      expect((await app.inject({ method: 'GET', url: '/v1/dashboards', headers })).json()).toEqual({
        items: [],
      });
      const detail = await app.inject({
        method: 'GET',
        url: '/v1/plugins/com.astra.research',
        headers,
      });
      expect(detail.json<{ installed: boolean }>().installed).toBe(false);
    });
  });
});
