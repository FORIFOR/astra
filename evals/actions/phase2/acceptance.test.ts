/**
 * Phase 2 受け入れテスト。Phase 2 実装仕様 §5 の AC2-1〜AC2-12。
 *
 *   pnpm test:acceptance
 *
 * 個別のサービステストと違い、ここは **HTTP から一続きに** 通す。
 * 「質問する → 調べる → レポートが Library に残る → 共有リンクを配る →
 * 受け取った人が開ける」までが 1 本の線として繋がっていることが Phase 2 の Exit。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { uuidv7, type Artifact, type Share, type Task, type TokenResponse } from '@astra/contracts';
import { createDb, withTenant, type DbHandle } from '@astra/db';
import { createLogger, readAuditChain, verifyAuditChain } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import {
  TaskService,
  TemporalTaskRuntime,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';
import {
  DeterministicLanguageModel,
  ResearchService,
  StaticSearchProvider,
  researchExecutors,
  type SearchHit,
} from '@astra/service-research';
import { ShareService } from '@astra/service-share';
import {
  MemoryRateLimiter,
  buildApp,
  JwtTokens,
  loadSigningKeys,
  type App,
} from '@astra/service-api-gateway';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const shareUrl = process.env['TEST_SHARE_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const TASK_QUEUE = 'astra.task.acceptance2';
const SHARE_HOST = 'http://localhost:1430';

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

const hit = (over: Partial<SearchHit> & Pick<SearchHit, 'url' | 'snippet'>): SearchHit => ({
  title: over.url,
  publisher: null,
  publishedAt: '2026-08-01T00:00:00.000Z',
  sourceType: 'news',
  ...over,
});

/** 一次情報と二次情報が違う数字を言っている。矛盾を見落とさないこと。 */
const CORPUS: SearchHit[] = [
  hit({
    url: 'https://official.example.com/ir',
    snippet: '当社の売上は 100 億円でした。従業員は 500 人です',
    sourceType: 'official',
    publisher: 'Example Inc',
  }),
  hit({
    url: 'https://filings.example.com/2026',
    snippet: '売上は 100 億円でした。市場は拡大しています',
    sourceType: 'filing',
    publisher: 'Regulator',
  }),
  hit({
    url: 'https://news.example.com/story',
    snippet: '当社の売上は 120 億円でした。強気の見通しです',
    sourceType: 'news',
    publisher: 'News Daily',
  }),
];

describe.skipIf(!url || !shareUrl)('Phase 2 acceptance', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let app: App;
  let library: LibraryService;
  let storeRoot: string;

  let auth: { authorization: string };
  let tenantId: string;
  let task: Task;
  let report: Artifact;

  const unlock = (token: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/public/share/unlock', payload: { token, ...extra } });

  const shareReport = async (payload: Record<string, unknown> = { expires_in: '1d' }) =>
    app.inject({
      method: 'POST',
      url: `/v1/artifacts/${report.id}/share`,
      headers: auth,
      payload,
    });

  const progressEvents = async (): Promise<{ message: string; detail: string | null }[]> => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${task.id}/stream`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    return res.body
      .split('\n\n')
      .filter((block) => block.includes('event: task.progress'))
      .map(
        (block) =>
          (
            JSON.parse(/data: (.+)/.exec(block)![1]!) as {
              payload: { message: string; detail: string | null };
            }
          ).payload,
      );
  };

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      shareUrl,
      shareMaxConnections: 2,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance2',
    };
    db = createDb(dbConfig);

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance2-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));

    // OQ-3 が決まるまで、検索と言語モデルは決定的な代役。
    // ここで見たいのは「取ってきた材料の扱い方」であって、モデルの賢さではない。
    const research = new ResearchService({
      db,
      search: new StaticSearchProvider(CORPUS),
      model: new DeterministicLanguageModel(),
    });

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      {
        db,
        library,
        publisher: { async publish() {} },
        executors: researchExecutors(research),
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
        shareHost: SHARE_HOST,
        requesterSalt: 'acceptance2-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance2', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance2' }),
      }),
      tasks: new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE)),
      library,
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      shares: new ShareService({ db, library, shareHost: SHARE_HOST }),
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ac2-${uuidv7()}@example.com`, display_name: 'Acceptance 2' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    tenantId = me.json<{ tenant: { id: string } }>().tenant.id;

    // ここから先の全 AC が、この 1 本のリサーチの上に乗る
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { ...auth, 'idempotency-key': `ac2-${uuidv7()}` },
      payload: { kind: 'research', input: { question: '当社の売上はいくらか' } },
    });
    expect(created.statusCode).toBe(202);
    task = created.json<Task>();
    await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();

    const finished = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${task.id}`,
      headers: auth,
    });
    task = finished.json<Task>();
    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${task.result_artifact_id}`,
      headers: auth,
    });
    expect(fetched.statusCode).toBe(200);
    report = fetched.json<Artifact>();
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC2-1: a research task goes plan → search → verify → report', async () => {
    expect(task.status).toBe('COMPLETED');
    const messages = (await progressEvents()).map((e) => e.message);
    expect(messages).toEqual([
      '調べることを整理しています',
      '公式資料と最新ニュースを照合中',
      '食い違いを確認しています',
      'レポートを作成しています',
    ]);
  });

  it('AC2-2: progress counts sources instead of faking a percentage', async () => {
    const details = (await progressEvents()).map((e) => e.detail);
    expect(details.some((d) => d?.endsWith('sources'))).toBe(true);
    // 段数が決まらない仕事なので % は出さない
    expect(details.some((d) => d?.includes('%'))).toBe(false);
  });

  it('AC2-3: the report lands in the library, traceable back to the task', async () => {
    expect(report.type).toBe('REPORT');
    expect(report.source_task_id).toBe(task.id);

    const listed = await app.inject({ method: 'GET', url: '/v1/artifacts', headers: auth });
    expect(listed.json<{ items: Artifact[] }>().items.map((a) => a.id)).toContain(report.id);
  });

  it('AC2-4: the evidence behind the conclusion is still there afterwards', async () => {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('evidence')
        .innerJoin('research_runs', 'research_runs.id', 'evidence.research_run_id')
        .select(['evidence.source_url as source_url', 'evidence.quality_score as quality_score'])
        .where('research_runs.task_id', '=', task.id)
        .execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    // 一次情報が二次情報より高いこと
    const official = rows.find((r) => r.source_url.includes('official'));
    const news = rows.find((r) => r.source_url.includes('news'));
    expect(Number(official?.quality_score)).toBeGreaterThan(Number(news?.quality_score));
  });

  it('AC2-5: disagreeing sources are recorded and the tone stays uncertain', async () => {
    const run = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('research_runs')
        .select(['confidence', 'source_count'])
        .where('task_id', '=', task.id)
        .executeTakeFirstOrThrow(),
    );
    // 100 億 と 120 億 が食い違っている以上、自信ありとは言わせない
    expect(run.confidence).toBe('low');
    expect(run.source_count).toBeGreaterThanOrEqual(3);

    const flagged = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('evidence')
        .innerJoin('research_runs', 'research_runs.id', 'evidence.research_run_id')
        .select(['evidence.contradicts as contradicts'])
        .where('research_runs.task_id', '=', task.id)
        .execute(),
    );
    expect(flagged.filter((r) => r.contradicts.length > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('AC2-6: the report can be shared, and a share must have an end date', async () => {
    // 無期限の共有は作らせない
    expect((await shareReport({})).statusCode).toBe(400);

    const res = await shareReport({ expires_in: '1h' });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ share: Share & { url_token: string }; url: string }>();
    // 秘密はフラグメント。サーバのアクセスログにも Referer にも残らない。
    expect(body.url.startsWith(`${SHARE_HOST}/s#`)).toBe(true);
    expect(body.share.policy.requires_password).toBe(false);
    expect(body.share.policy.allow_download).toBe(false);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${report.id}/shares`,
      headers: auth,
    });
    // 一覧に平文トークンが出てこない
    expect(JSON.stringify(listed.json())).not.toContain(body.share.url_token);
  });

  it('AC2-7: a password-protected link opens only with the right password', async () => {
    const created = (await shareReport({ expires_in: '1d', password: 'correct horse' })).json<{
      share: { url_token: string };
    }>();
    expect((await unlock(created.share.url_token)).statusCode).toBe(404);
    expect((await unlock(created.share.url_token, { password: 'wrong' })).statusCode).toBe(404);

    const ok = await unlock(created.share.url_token, { password: 'correct horse' });
    expect(ok.statusCode).toBe(200);
    const opened = ok.json<{ view_token: string; artifact: Record<string, unknown> }>();
    // 受け取った人にテナントの内部 id を渡さない
    expect(JSON.stringify(opened.artifact)).not.toContain(tenantId);

    const content = await app.inject({
      method: 'GET',
      url: '/public/share/content',
      headers: { authorization: `Share ${opened.view_token}` },
    });
    expect(content.statusCode).toBe(200);
    expect(content.body).toContain('## 結論');
  });

  it('AC2-8: expired, revoked and used-up links are all dead', async () => {
    const expiring = (await shareReport({ expires_in_seconds: 1 })).json<{
      share: { url_token: string };
    }>();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect((await unlock(expiring.share.url_token)).statusCode).toBe(404);

    const revocable = (await shareReport({ expires_in: '1d' })).json<{
      share: { id: string; url_token: string };
    }>();
    expect((await unlock(revocable.share.url_token)).statusCode).toBe(200);
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/v1/shares/${revocable.share.id}`,
      headers: auth,
    });
    expect(revoked.statusCode).toBe(204);
    expect((await unlock(revocable.share.url_token)).statusCode).toBe(404);

    const once = (await shareReport({ expires_in: '1d', one_time: true })).json<{
      share: { url_token: string };
    }>();
    expect((await unlock(once.share.url_token)).statusCode).toBe(200);
    expect((await unlock(once.share.url_token)).statusCode).toBe(404);
  }, 30_000);

  it('AC2-9: guessing the password gets rate limited', async () => {
    const created = (await shareReport({ expires_in: '1d', password: 'secret pass' })).json<{
      share: { url_token: string };
    }>();
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      codes.push((await unlock(created.share.url_token, { password: `guess-${i}` })).statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);

    // 制限はリンク単位。ほかの共有を巻き添えにしない。
    const untouched = (await shareReport({ expires_in: '1d' })).json<{
      share: { url_token: string };
    }>();
    expect((await unlock(untouched.share.url_token)).statusCode).toBe(200);
  }, 60_000);

  it('AC2-10: sharing and every access land on an intact audit chain', async () => {
    const chain = await withTenant(db, tenantId, (tx) => readAuditChain(tx, tenantId));
    const actions = chain.map((r) => r.action);
    expect(actions).toContain('artifact.shared');
    expect(actions).toContain('artifact.share_accessed');
    expect(actions).toContain('artifact.share_revoked');
    expect(await verifyAuditChain(chain)).toEqual([]);
    // 外部に出す操作なので external_effect が立っていること
    expect(chain.some((r) => r.action === 'artifact.shared' && r.external_effect)).toBe(true);

    const logs = await withTenant(db, tenantId, (tx) =>
      tx.selectFrom('share_access_logs').selectAll().execute(),
    );
    expect(logs.some((l) => l.outcome === 'denied')).toBe(true);
    for (const log of logs) {
      // 生の住所ではなくハッシュだけ持つ
      if (log.requester_hash) expect(log.requester_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('AC2-11: no raw storage url ever leaves the process', async () => {
    const created = (await shareReport({ expires_in: '1d' })).json<{
      share: { url_token: string };
    }>();
    const opened = (await unlock(created.share.url_token)).json<{ view_token: string }>();

    // view token 無しでは本文に触れない
    expect((await app.inject({ method: 'GET', url: '/public/share/content' })).statusCode).toBe(
      404,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/public/share/content',
      headers: { authorization: `Share ${opened.view_token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');

    const exposed = JSON.stringify({ headers: res.headers, body: res.body });
    expect(exposed).not.toContain('file://');
    expect(exposed).not.toContain(storeRoot);
  });

  it('AC2-12: another tenant cannot share this report', async () => {
    const outsider = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `out-${uuidv7()}@example.com`, display_name: 'Outsider' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${report.id}/share`,
      headers: { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` },
      payload: { expires_in: '1d' },
    });
    // 403 だと「その artifact はある」と教えることになる
    expect(res.statusCode).toBe(404);
  });
});
