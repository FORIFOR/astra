/**
 * Phase 5 受け入れテスト。Phase 5 実装仕様 §1 の AC5-1〜AC5-10。
 *
 *   pnpm test:acceptance
 *
 * Phase 4 の AC4-2 は `installed: true` しか見ておらず、
 * 「agent が使えるようになった」ことを確かめていなかった。ここで閉じる。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import {
  uuidv7,
  type DashboardView,
  type DomainEntity,
  type Task,
  type TokenResponse,
} from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import {
  PluginRegistryService,
  agentResolver,
  assetReader,
  composeDataSources,
} from '@astra/service-plugin-registry';
import {
  DomainService,
  entityDefinitions,
  salesCrmDataSources,
} from '@astra/service-agent-runtime';
import {
  TaskService,
  TemporalTaskRuntime,
  agentKindFor,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';
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
const TASK_QUEUE = 'astra.task.acceptance5';
const CRM = 'com.astra.sales-crm';

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

describe.skipIf(!url)('Phase 5 acceptance', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let app: App;
  let registry: PluginRegistryService;
  let domain: DomainService;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;
  /** plugin の tool が実際に呼ばれたか。 */
  const called: string[] = [];

  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url, headers, payload: payload as never });

  const get = (url: string, headers = auth) => app.inject({ method: 'GET', url, headers });

  /** POST /v1/tasks は冪等キーが必須。忘れると 400 になる。 */
  const createTask = (kind: string, input: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { ...auth, 'idempotency-key': `ac5-${uuidv7()}` },
      payload: { kind, input },
    });

  const opportunity = (fields: Record<string, unknown>) =>
    post(`/v1/plugins/${CRM}/entities/opportunity`, { fields });

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance5',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance5-'));
    const library = new LibraryService(db, new FsObjectStore(storeRoot));
    registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.seedBuiltins(path.join(repoRoot, 'plugins/builtin'));
    domain = new DomainService({ db });

    const tool = (id: string) => ({
      async execute() {
        called.push(id);
        return { result: { tool: id }, detail: null };
      },
    });

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      {
        db,
        library,
        publisher: { async publish() {} },
        executors: {
          'crm.pipeline': tool('crm.pipeline'),
          'crm.next_action': tool('crm.next_action'),
        },
      },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: path.join(repoRoot, 'services/task/src/workflows.ts'),
      },
    );
    workerRun = worker.run();

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
        requesterSalt: 'acceptance5-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance5', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance5' }),
      }),
      tasks: new TaskService(
        db,
        new TemporalTaskRuntime(env.client, TASK_QUEUE),
        agentResolver(registry),
      ),
      library,
      registry,
      dataSources: composeDataSources(salesCrmDataSources(domain, () => new Date('2026-08-26'))),
      domain: { domain, definitions: entityDefinitions(assetReader(registry)) },
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await post(
      '/v1/auth/dev/token',
      {
        email: `ac5-${uuidv7()}@example.com`,
        display_name: 'Acceptance 5',
      },
      {} as never,
    );
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    tenantId = (await get('/v1/me')).json<{ tenant: { id: string } }>().tenant.id;
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC5-6: the agent cannot be run before its plugin is installed', async () => {
    const res = await createTask(agentKindFor(CRM, 'analyst'));
    expect(res.statusCode).toBe(400);
  });

  it('AC5-3: it refuses to start when a required scope was not granted', async () => {
    await post(`/v1/plugins/${CRM}/install`, {
      version: '0.1.0',
      granted_scopes: ['artifacts.read'],
    });
    const res = await createTask(agentKindFor(CRM, 'analyst'));
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('artifacts.write');
  });

  it('AC5-1 / AC5-2: the installed agent runs, using only its declared tools', async () => {
    await post(`/v1/plugins/${CRM}/install`, {
      version: '0.1.0',
      granted_scopes: ['artifacts.read', 'artifacts.write'],
    });
    called.length = 0;

    const created = await createTask(agentKindFor(CRM, 'analyst'), {
      message: '今月の商談を見て',
    });
    expect(created.statusCode).toBe(202);
    const task = created.json<Task>();
    await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();

    const done = (await get(`/v1/tasks/${task.id}`)).json<Task>();
    expect(done.status).toBe('COMPLETED');
    // core に kind を足していない。install した宣言から計画が立った。
    expect(called).toEqual(['crm.pipeline', 'crm.next_action']);
  }, 120_000);

  it('AC5-7: the entity definitions the plugin brought are what validation uses', async () => {
    const bad = await opportunity({ name: 'A社', stage: 'maybe' });
    expect(bad.statusCode).toBe(400);

    const good = await opportunity({ name: 'A社', stage: 'lead', amount: 1_000 });
    expect(good.statusCode).toBe(201);
    const entity = good.json<DomainEntity>();
    expect(entity.title).toBe('A社');
    // 定義に無い項目は入らない
    expect(Object.keys(entity.fields).sort()).toEqual(['amount', 'name', 'stage']);

    // 宣言していない entity 型は無い
    expect((await post(`/v1/plugins/${CRM}/entities/invented`, { fields: {} })).statusCode).toBe(
      404,
    );
  });

  it('AC5-8: the pipeline adds up from what was stored', async () => {
    await opportunity({ name: 'B社', stage: 'qualified', amount: 4_000 });
    await opportunity({ name: 'C社', stage: 'won', amount: 9_000 });

    const res = await get(`/v1/plugins/${CRM}/dashboards/pipeline`);
    expect(res.statusCode).toBe(200);
    const view = res.json<DashboardView>();

    const byStage = view.data['crm.by_stage'];
    expect(byStage).toMatchObject({ kind: 'series' });
    // stage は定義の順で出る。見るたびに段が動かない。
    expect((byStage as { points: { label: string }[] }).points.map((p) => p.label)).toEqual([
      'lead',
      'qualified',
      'proposal',
      'won',
      'lost',
    ]);

    // 進行中だけの合計（won は数えない）
    expect(view.data['crm.open_total']).toEqual({ kind: 'count', value: 5_000 });
  });

  it('AC5-9: a next best action can be traced to the activity behind it', async () => {
    const opp = (
      await opportunity({ name: 'D社', stage: 'proposal', amount: 2_000 })
    ).json<DomainEntity>();
    const activity = (
      await post(`/v1/plugins/${CRM}/entities/activity`, {
        fields: { summary: '見積を送付', occurred_at: '2026-07-01', kind: 'email' },
      })
    ).json<DomainEntity>();

    expect(
      (await post(`/v1/entities/${opp.id}/links`, { to_id: activity.id, relation: 'activity' }))
        .statusCode,
    ).toBe(204);

    const linked = (await get(`/v1/entities/${opp.id}/links?relation=activity`)).json<{
      items: DomainEntity[];
    }>();
    expect(linked.items.map((e) => e.title)).toEqual(['見積を送付']);

    // dashboard の「放置されている商談」に、理由付きで出る
    const view = (await get(`/v1/plugins/${CRM}/dashboards/pipeline`)).json<DashboardView>();
    const stale = view.data['crm.stale'] as { kind: string; rows: string[][] };
    expect(stale.kind).toBe('rows');
    const row = stale.rows.find((r) => r[0] === 'D社');
    expect(row, 'D社 should be flagged as neglected').toBeDefined();
    // **根拠が書いてある**。「そろそろ連絡を」だけでは出さない。
    expect(row![2]).toMatch(/\d+ 日/);
  });

  it('AC5-10: another tenant sees none of these entities', async () => {
    const outsider = await post(
      '/v1/auth/dev/token',
      { email: `ot5-${uuidv7()}@example.com`, display_name: 'OT' },
      {} as never,
    );
    const headers = { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` };

    // install していないので entity の口自体が無い
    expect((await get(`/v1/plugins/${CRM}/entities/opportunity`, headers)).statusCode).toBe(404);

    // install しても、見えるのは自分のものだけ
    await post(`/v1/plugins/${CRM}/install`, { version: '0.1.0', granted_scopes: [] }, headers);
    const listed = (await get(`/v1/plugins/${CRM}/entities/opportunity`, headers)).json<{
      items: DomainEntity[];
    }>();
    expect(listed.items).toEqual([]);
  });
});
