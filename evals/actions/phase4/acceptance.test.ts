/**
 * Phase 4 受け入れテスト。Phase 4 実装仕様 §0 の AC4-1〜AC4-12。
 *
 *   pnpm test:acceptance
 *
 * 正本 §28 Phase 4 Exit「plugin install だけで Agent + Dashboard が増える」を
 * **HTTP から**検証する。**コードを一行も足さずに増えること**が判定の核。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sha256Hex,
  uuidv7,
  type DashboardView,
  type PluginCatalogEntry,
  type TokenResponse,
} from '@astra/contracts';
import { createDb, withSystem, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService, composeDataSources } from '@astra/service-plugin-registry';
import {
  generatePublisherKeyPair,
  loadManifest,
  signManifest,
  type PluginAsset,
} from '@astra/plugin-sdk';
import { InMemoryTaskRuntime, TaskService } from '@astra/service-task';
import {
  MemoryRateLimiter,
  buildApp,
  JwtTokens,
  loadSigningKeys,
  type App,
} from '@astra/service-api-gateway';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

// 受け入れスイート専用の id と publisher。**別スイートと共有しない。**
// 同じ DB を並行で使うので、同じ publisher を別の鍵で登録し合うと署名が崩れる。
const PLUGIN_ID = 'com.acceptance.pipeline';
const PUBLISHER_ID = 'acceptance-publisher';
const publisher = generatePublisherKeyPair();

const dashboardFor = (id: string, bind: string) =>
  Buffer.from(
    JSON.stringify({
      id,
      title: 'パイプライン',
      layout: 'grid',
      items: [
        { type: 'metric', title: '件数', bind, span: 4 },
        { type: 'table', title: '一覧', bind: `${bind.split('.')[0]}.recent`, span: 12 },
      ],
    }),
  );

describe.skipIf(!url)('Phase 4 acceptance', () => {
  let db: DbHandle;
  let app: App;
  let registry: PluginRegistryService;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;

  const asAssets = async (content: Buffer, at = 'dashboards/pipeline.json') => {
    const asset: PluginAsset = {
      path: at,
      kind: 'dashboard',
      content,
      sha256: await sha256Hex(content),
    };
    return [asset];
  };

  const manifest = async (version: string, over: Record<string, unknown> = {}) => {
    const base = {
      id: PLUGIN_ID,
      name: 'Pipeline',
      version,
      publisher: PUBLISHER_ID,
      verified: false,
      min_core_version: '0.1.0',
      category: 'domain-agent',
      compliance_profile: 'GENERAL',
      execution_surfaces: ['cloud'],
      permissions: ['artifacts.read'],
      data_accessed: ['この利用者が既に見られる商談'],
      dashboards: [{ id: 'pipeline', schema: 'dashboards/pipeline.json' }],
      data_sources: [
        { id: 'acceptance.total', kind: 'count', query: 'research_runs' },
        { id: 'acceptance.recent', kind: 'rows', query: 'research_recent' },
      ],
      ...over,
    };
    const unsigned = await loadManifest(base, 'acceptance');
    return loadManifest(
      { ...base, signature: signManifest(unsigned.canonical, publisher.privateKey) },
      'acceptance',
    );
  };

  const install = (version: string, scopes: string[] = []) =>
    app.inject({
      method: 'POST',
      url: `/v1/plugins/${PLUGIN_ID}/install`,
      headers: auth,
      payload: { version, granted_scopes: scopes },
    });

  const dashboards = async () =>
    (await app.inject({ method: 'GET', url: '/v1/dashboards', headers: auth })).json<{
      items: { plugin_id: string; id: string }[];
    }>().items;

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance4',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance4-'));
    const library = new LibraryService(db, new FsObjectStore(storeRoot));
    registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.seedBuiltins(path.join(repoRoot, 'plugins/builtin'));

    await withSystem(db, (tx) =>
      tx
        .insertInto('plugin_publishers')
        .values({
          id: PUBLISHER_ID,
          display_name: 'Acceptance',
          public_key: publisher.publicKey,
          verified: false,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute(),
    );

    app = buildApp({
      config: {
        env: 'test',
        port: 0,
        host: '127.0.0.1',
        logLevel: 'silent',
        redisUrl: undefined,
        version: '0.1.0',
        db: dbConfig,
        builtinPluginsDir: path.join(repoRoot, 'plugins/builtin'),
        objectStoreRoot: storeRoot,
        recordingRoot: storeRoot,
        allowedOrigins: [],
        shareHost: 'http://localhost:1430',
        requesterSalt: 'acceptance4-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance4', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance4' }),
      }),
      tasks: new TaskService(db, new InMemoryTaskRuntime()),
      library,
      registry,
      dataSources: composeDataSources({
        research_runs: async () => ({ kind: 'count', value: 11 }),
        research_recent: async () => ({
          kind: 'rows',
          columns: ['商談'],
          rows: [['A社']],
        }),
      }),
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ac4-${uuidv7()}@example.com`, display_name: 'Acceptance 4' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    tenantId = me.json<{ tenant: { id: string } }>().tenant.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC4-1: refuses to publish a plugin whose declared files are missing', async () => {
    await expect(registry.publish(await manifest('1.0.0'), [])).rejects.toThrow(
      /declares "dashboards\/pipeline.json"/,
    );

    // 中身が壊れていても止める。ファイルがあるだけでは足りない。
    await expect(
      registry.publish(await manifest('1.0.0'), await asAssets(Buffer.from('not json'))),
    ).rejects.toThrow(/not JSON/);

    // 宣言していない bind を指す dashboard も止める（install 後に必ず穴になる）
    const stray = Buffer.from(
      JSON.stringify({
        id: 'pipeline',
        title: 'x',
        items: [{ type: 'metric', bind: 'acceptance.nowhere' }],
      }),
    );
    await expect(registry.publish(await manifest('1.0.0'), await asAssets(stray))).rejects.toThrow(
      /does not declare/,
    );
  });

  it('AC4-2 / AC4-3: installing adds the agent and the dashboard, with no code change', async () => {
    await registry.publish(
      await manifest('1.0.0'),
      await asAssets(dashboardFor('pipeline', 'acceptance.total')),
    );

    expect(await dashboards()).toEqual([]);
    expect((await install('1.0.0', ['artifacts.read'])).statusCode).toBe(201);

    // コードは一行も足していない。install だけで増えた。
    expect(await dashboards()).toEqual([
      expect.objectContaining({ plugin_id: PLUGIN_ID, id: 'pipeline' }),
    ]);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/plugins/${PLUGIN_ID}`,
      headers: auth,
    });
    expect(detail.json<PluginCatalogEntry>().installed).toBe(true);
  });

  it('AC4-4: the dashboard is data, not code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plugins/${PLUGIN_ID}/dashboards/pipeline`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const view = res.json<DashboardView>();
    // 描くのは core が知っている component だけ
    expect(view.schema.items.map((i) => i.type)).toEqual(['metric', 'table']);
    expect(JSON.stringify(view)).not.toContain('<script');
    expect(view.data['acceptance.total']).toEqual({ kind: 'count', value: 11 });
  });

  it('AC4-5: an unresolvable bind comes back with a reason, not a zero', async () => {
    await registry.publish(
      await manifest('1.2.0', {
        data_sources: [{ id: 'acceptance.total', kind: 'count', query: 'no_such_query' }],
        dashboards: [{ id: 'pipeline', schema: 'dashboards/pipeline.json' }],
      }),
      await asAssets(
        Buffer.from(
          JSON.stringify({
            id: 'pipeline',
            title: 'パイプライン',
            items: [{ type: 'metric', title: '件数', bind: 'acceptance.total' }],
          }),
        ),
      ),
    );
    await install('1.2.0', ['artifacts.read']);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/plugins/${PLUGIN_ID}/dashboards/pipeline`,
      headers: auth,
    });
    const value = res.json<DashboardView>().data['acceptance.total'];
    expect(value).toMatchObject({ kind: 'unavailable' });
    expect((value as { reason: string }).reason).toContain('no_such_query');
  });

  it('AC4-6: the detail page shows what will be touched before anything is granted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plugins/com.astra.gmail',
      headers: auth,
    });
    const detail = res.json<PluginCatalogEntry>();
    // §11.1 の必須項目。押す前に見えていなければ同意にならない。
    expect(detail.data_accessed.length).toBeGreaterThan(0);
    expect(detail.permissions.length).toBeGreaterThan(0);
    expect(detail.execution_surfaces.length).toBeGreaterThan(0);
    expect(detail.signature_state).toBeTruthy();
    expect(detail.installed).toBe(false);
  });

  it('AC4-7: a scope that was never granted stays denied', async () => {
    await install('1.2.0', []);
    expect(await registry.isPermitted(tenantId, PLUGIN_ID, 'artifacts.read')).toBe(false);

    await install('1.2.0', ['artifacts.read']);
    expect(await registry.isPermitted(tenantId, PLUGIN_ID, 'artifacts.read')).toBe(true);
    // 宣言されていない scope は、渡しても付かない
    expect(await registry.isPermitted(tenantId, PLUGIN_ID, 'crm.write')).toBe(false);
  });

  it('AC4-8: a plugin that needs a newer core cannot be installed', async () => {
    await registry.publish(
      await manifest('2.0.0', { min_core_version: '9.0.0' }),
      await asAssets(dashboardFor('pipeline', 'acceptance.total')),
    );
    const res = await install('2.0.0', ['artifacts.read']);
    expect(res.statusCode).toBe(409);
  });

  it('AC4-9: update goes forward, and refuses to go backwards', async () => {
    await registry.publish(
      await manifest('1.3.0'),
      await asAssets(dashboardFor('pipeline', 'acceptance.total')),
    );
    const forward = await app.inject({
      method: 'POST',
      url: `/v1/plugins/${PLUGIN_ID}/update`,
      headers: auth,
      payload: { version: '1.3.0' },
    });
    expect(forward.statusCode).toBe(200);
    expect(forward.json<{ version: string }>().version).toBe('1.3.0');

    const backwards = await app.inject({
      method: 'POST',
      url: `/v1/plugins/${PLUGIN_ID}/update`,
      headers: auth,
      payload: { version: '1.2.0' },
    });
    // 下げるのは rollback の仕事
    expect(backwards.statusCode).toBe(409);
  });

  it('AC4-10: rollback returns to the version it came from', async () => {
    const back = await app.inject({
      method: 'POST',
      url: `/v1/plugins/${PLUGIN_ID}/rollback`,
      headers: auth,
    });
    expect(back.statusCode).toBe(200);
    expect(back.json<{ version: string }>().version).toBe('1.2.0');
  });

  it('AC4-11: uninstalling takes the dashboard away again', async () => {
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/plugins/${PLUGIN_ID}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(204);
    expect(await dashboards()).toEqual([]);

    // 中核の Agent は消せない
    const core = await app.inject({
      method: 'DELETE',
      url: '/v1/plugins/com.astra.research',
      headers: auth,
    });
    expect(core.statusCode).toBe(403);
  });

  it('AC4-12: another tenant sees none of this tenant’s installs', async () => {
    await install('1.2.0', ['artifacts.read']);

    const outsider = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ot4-${uuidv7()}@example.com`, display_name: 'OT' },
    });
    const headers = { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` };

    expect((await app.inject({ method: 'GET', url: '/v1/dashboards', headers })).json()).toEqual({
      items: [],
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/plugins/${PLUGIN_ID}`,
      headers,
    });
    expect(detail.json<PluginCatalogEntry>().installed).toBe(false);

    // dashboard そのものも見えない
    const board = await app.inject({
      method: 'GET',
      url: `/v1/plugins/${PLUGIN_ID}/dashboards/pipeline`,
      headers,
    });
    expect(board.statusCode).toBe(404);
  });
});
