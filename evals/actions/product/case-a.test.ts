/**
 * 正本 §30 Case A。
 *
 *   「この会社について競合と比較して調べて」
 *   → sources → report → Library → share link
 *
 * ほかの受け入れは層ごとに切って見ているが、ここは**切らずに通す**。
 * 層ごとに正しくても、繋ぎ目で落ちれば利用者には何も届かない。
 *
 * 合格の基準は「機能が動いた」ではなく、
 * **頼んだ人の手元に、共有できる成果が残ったか**。
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
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { ShareService } from '@astra/service-share';
import { ConversationService } from '@astra/service-conversation';
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
const TASK_QUEUE = 'astra.task.case-a';

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

/** 数字が食い違う source を混ぜてある。**都合よく片方だけ採らないこと。** */
const CORPUS: SearchHit[] = [
  hit({
    url: 'https://official.example.com/ir',
    snippet: '当社の売上は 100 億円でした',
    sourceType: 'official',
    publisher: 'Example Inc',
  }),
  hit({
    url: 'https://filings.example.com/2026',
    snippet: '売上は 100 億円でした',
    sourceType: 'filing',
    publisher: 'Regulator',
  }),
  hit({
    url: 'https://news.example.com/story',
    snippet: '当社の売上は 120 億円でした',
    sourceType: 'news',
    publisher: 'News Daily',
  }),
];

describe.skipIf(!url || !shareUrl)('Case A — ask, and get something you can hand over', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let app: App;
  let library: LibraryService;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;

  /** 利用者が実際にやることだけを並べる。内部を直接触らない。 */
  let conversationId: string;
  let task: Task;
  let report: Artifact;
  let shareToken: string;

  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url, headers, payload: payload as never });
  const get = (url: string, headers = auth) => app.inject({ method: 'GET', url, headers });

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
      applicationName: 'astra-case-a',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-case-a-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));

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
        shareHost: 'http://localhost:1430',
        requesterSalt: 'case-a-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'case-a', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'case-a' }),
      }),
      tasks: new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE)),
      library,
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      shares: new ShareService({ db, library, shareHost: 'http://localhost:1430' }),
      conversations: new ConversationService({ db }),
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await post(
      '/v1/auth/dev/token',
      { email: `case-a-${uuidv7()}@example.com`, display_name: 'はじめての人' },
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

  it('1. asking is one sentence, and it is understood without asking back', async () => {
    conversationId = (await post('/v1/conversations', { title: '競合調査' })).json<{
      id: string;
    }>().id;

    const said = await post(`/v1/conversations/${conversationId}/turns`, {
      text: 'この会社について競合と比較して調べて',
      // 画面に会社のページが出ている。**説明し直させない**（正本 §6）
      context_referents: [{ label: 'Example Inc', kind: 'organization' }],
    });
    expect(said.statusCode).toBe(202);
    const body = said.json<{ needs_clarification: boolean; intent: string }>();
    // 画面に出ているので「この会社」を聞き返さない
    expect(body.needs_clarification).toBe(false);
    // 「調べる話だ」と分かる
    expect(body.intent).toBe('looking_up');
  });

  it('2. the work starts, and says what it is doing while it runs', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { ...auth, 'idempotency-key': `case-a-${uuidv7()}` },
      payload: {
        kind: 'research',
        input: { question: 'この会社について競合と比較して調べて' },
        conversation_id: conversationId,
      },
    });
    expect(created.statusCode).toBe(202);
    task = created.json<Task>();

    await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();
    task = (await get(`/v1/tasks/${task.id}`)).json<Task>();
    expect(task.status).toBe('COMPLETED');

    const stream = await get(`/v1/tasks/${task.id}/stream`);
    const messages = stream.body
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

    // **黙って考え込む時間を作らない**（正本 §4.3）
    expect(messages.length).toBeGreaterThanOrEqual(4);
    // 何件見たかが出る。段数が決まらないので % は出さない（§6.2）
    expect(messages.some((m) => m.detail?.endsWith('sources'))).toBe(true);
    for (const message of messages) {
      // tool 名を利用者に見せない
      expect(message.message).not.toMatch(/research\./);
    }
  }, 180_000);

  it('3. the report is honest about the sources disagreeing', async () => {
    report = (await get(`/v1/artifacts/${task.result_artifact_id}`)).json<Artifact>();
    expect(report.type).toBe('REPORT');

    const content = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${report.id}/content`,
      headers: auth,
    });
    expect(content.body).toContain('## 結論');
    expect(content.body).toContain('## 出典');

    // 100 億 と 120 億 が食い違っている。**都合よく片方だけ採らない。**
    const run = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('research_runs')
        .select(['confidence', 'source_count'])
        .where('task_id', '=', task.id)
        .executeTakeFirstOrThrow(),
    );
    expect(run.confidence).toBe('low');
    expect(run.source_count).toBeGreaterThanOrEqual(3);
  });

  it('4. it is in the Library without anyone filing it', async () => {
    // 「どこに保存された？」と探させない（正本 §2.3）
    const listed = (await get('/v1/artifacts?limit=50')).json<{ items: Artifact[] }>();
    expect(listed.items.map((a) => a.id)).toContain(report.id);
    // どの仕事から生まれたかが辿れる
    expect(report.source_task_id).toBe(task.id);
  });

  it('5. it can be handed to someone outside, safely', async () => {
    const shared = await post(`/v1/artifacts/${report.id}/share`, {
      expires_in: '1d',
      password: 'correct horse',
    });
    expect(shared.statusCode).toBe(201);
    const body = shared.json<{ share: Share & { url_token: string }; url: string }>();
    shareToken = body.share.url_token;

    // 秘密はフラグメント。サーバのログにも Referer にも残らない
    expect(body.url).toContain('/s#');
    // 既定で持ち出させない
    expect(body.share.policy.allow_download).toBe(false);
  });

  it('6. the person outside sees the report, and nothing else', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/public/share/unlock',
      payload: { token: shareToken, password: 'wrong' },
    });
    expect(wrong.statusCode).toBe(404);

    const opened = await app.inject({
      method: 'POST',
      url: '/public/share/unlock',
      payload: { token: shareToken, password: 'correct horse' },
    });
    expect(opened.statusCode).toBe(200);
    const view = opened.json<{ view_token: string; artifact: Record<string, unknown> }>();

    // 受け取った人にテナントの内部 id を渡さない
    expect(JSON.stringify(view.artifact)).not.toContain(tenantId);

    const content = await app.inject({
      method: 'GET',
      url: '/public/share/content',
      headers: { authorization: `Share ${view.view_token}` },
    });
    expect(content.statusCode).toBe(200);
    expect(content.body).toContain('## 結論');
    // 保存はさせない
    expect(content.headers['content-disposition']).toBe('inline');
    // 検索させない
    expect(content.headers['x-robots-tag']).toContain('noindex');
  });

  it('7. every step of that is on an audit chain that has not been tampered with', async () => {
    const { readAuditChain, verifyAuditChain } = await import('@astra/telemetry');
    const chain = await withTenant(db, tenantId, (tx) => readAuditChain(tx, tenantId));
    const actions = chain.map((r) => r.action);

    expect(actions).toContain('task.created');
    expect(actions).toContain('artifact.shared');
    expect(actions).toContain('artifact.share_accessed');
    expect(await verifyAuditChain(chain)).toEqual([]);
  });
});
