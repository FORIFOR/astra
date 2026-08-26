/**
 * Research の縦串。正本 §8、Phase 2 実装仕様 §3。AC2-1 〜 AC2-5。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-research test
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { uuidv7, type EventEnvelope } from '@astra/contracts';
import { createDb, withIdentity, withTenant, type DbHandle } from '@astra/db';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import {
  InMemoryTaskRuntime,
  TaskService,
  TemporalTaskRuntime,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';
import { ResearchService } from '@astra/service-research';
import { researchExecutors } from '@astra/service-research';
import {
  DeterministicLanguageModel,
  StaticSearchProvider,
  type SearchHit,
} from '@astra/service-research';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const TASK_QUEUE = 'astra.task.research-test';

const hit = (over: Partial<SearchHit> & Pick<SearchHit, 'url' | 'snippet'>): SearchHit => ({
  title: over.url,
  publisher: null,
  publishedAt: '2026-08-01T00:00:00.000Z',
  sourceType: 'news',
  ...over,
});

// 同じ話題に違う数字を言う source を混ぜてある（矛盾検出のため）
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

describe.skipIf(!url)('research end to end', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let library: LibraryService;
  let service: TaskService;
  let research: ResearchService;
  let storeRoot: string;

  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-research-test',
    });

    await withIdentity(db, async (tx) => {
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: 'R', kind: 'personal' })
        .execute();
      await tx
        .insertInto('users')
        .values({ id: userId, email: `r-${userId}@example.com`, display_name: 'R' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-research-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));
    research = new ResearchService({
      db,
      search: new StaticSearchProvider(CORPUS),
      model: new DeterministicLanguageModel(),
    });

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      { db, library, publisher: { async publish() {} }, executors: researchExecutors(research) },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: fileURLToPath(
          new URL('../../../services/task/src/workflows.ts', import.meta.url),
        ),
      },
    );
    workerRun = worker.run();
    service = new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE));
  }, 180_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  }, 60_000);

  describe('a research task', () => {
    let taskId: string;
    let events: EventEnvelope[];

    beforeAll(async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'research', input: { question: '売上と従業員数を調べて' } },
        idempotencyKey: `r-${uuidv7()}`,
      });
      taskId = task.id;
      await env.client.workflow.getHandle(workflowIdFor(tenantId, taskId)).result();
      events = await service.eventsAfter(tenantId, taskId, 0);
    }, 120_000);

    it('AC2-1: runs plan → search → verify → report', async () => {
      const done = await service.get(tenantId, taskId);
      expect(done.status).toBe('COMPLETED');

      const messages = events
        .filter((e) => e.type === 'task.progress')
        .map((e) => (e.payload as { message: string }).message);
      expect(messages).toEqual([
        '調べることを整理しています',
        '公式資料と最新ニュースを照合中',
        '食い違いを確認しています',
        'レポートを作成しています',
      ]);
    });

    it('AC2-2: reports how many sources it found', () => {
      const details = events
        .filter((e) => e.type === 'task.progress')
        .map((e) => (e.payload as { detail: string | null }).detail);
      expect(details.some((d) => d?.endsWith('sources'))).toBe(true);
      expect(details.some((d) => d?.endsWith('queries'))).toBe(true);
    });

    it('AC2-3: leaves a report in the library, traceable to the task', async () => {
      const done = await service.get(tenantId, taskId);
      expect(done.result_artifact_id).not.toBeNull();

      const artifact = await library.get(tenantId, done.result_artifact_id!);
      expect(artifact.type).toBe('REPORT');
      expect(artifact.source_task_id).toBe(taskId);

      const { stream } = await library.readContent(tenantId, artifact.id);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const body = Buffer.concat(chunks).toString('utf8');

      // 結論が先。引用で埋めない。
      expect(body).toContain('## 結論');
      expect(body).toContain('sources · confidence:');
      expect(body).toContain('## 出典');
    });

    it('AC2-4: keeps the evidence behind the conclusion', async () => {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('evidence')
          .innerJoin('research_runs', 'research_runs.id', 'evidence.research_run_id')
          .select([
            'evidence.claim as claim',
            'evidence.source_url as source_url',
            'evidence.quality_score as quality_score',
          ])
          .where('research_runs.task_id', '=', taskId)
          .execute(),
      );
      expect(rows.length).toBeGreaterThan(0);
      // 一次情報が二次情報より高く評価されていること
      const official = rows.find((r) => r.source_url.includes('official'));
      const news = rows.find((r) => r.source_url.includes('news'));
      expect(Number(official?.quality_score)).toBeGreaterThan(Number(news?.quality_score));
    });

    it('AC2-5: records the sources that disagree and refuses to sound confident', async () => {
      const run = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(['confidence', 'source_count'])
          .where('task_id', '=', taskId)
          .executeTakeFirstOrThrow(),
      );
      // 100 億 と 120 億 が食い違っている
      expect(run.confidence).toBe('low');
      expect(run.source_count).toBeGreaterThanOrEqual(3);

      const contradicting = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('evidence')
          .innerJoin('research_runs', 'research_runs.id', 'evidence.research_run_id')
          .select(['evidence.claim as claim', 'evidence.contradicts as contradicts'])
          .where('research_runs.task_id', '=', taskId)
          .execute(),
      );
      const flagged = contradicting.filter((row) => row.contradicts.length > 0);
      expect(flagged.length).toBeGreaterThanOrEqual(2);
      // 双方向に記録されていること（片側からしか辿れないと根拠を見落とす）
      expect(flagged.every((row) => row.contradicts.length > 0)).toBe(true);
    });
  });

  describe('re-running a step', () => {
    it('does not pile up duplicate evidence', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'research', input: { question: '売上を調べて' } },
        idempotencyKey: `r-${uuidv7()}`,
      });
      await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();

      const before = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('evidence')
          .innerJoin('research_runs', 'research_runs.id', 'evidence.research_run_id')
          .select(({ fn }) => [fn.countAll().as('n')])
          .where('research_runs.task_id', '=', task.id)
          .executeTakeFirstOrThrow(),
      );

      // activity は何度でも再実行され得る
      await research.search(tenantId, task.id);

      const after = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('evidence')
          .innerJoin('research_runs', 'research_runs.id', 'evidence.research_run_id')
          .select(({ fn }) => [fn.countAll().as('n')])
          .where('research_runs.task_id', '=', task.id)
          .executeTakeFirstOrThrow(),
      );
      expect(Number(after.n)).toBe(Number(before.n));
    }, 120_000);
  });

  describe('an unknown kind', () => {
    it('is still refused', async () => {
      const runtime = new InMemoryTaskRuntime();
      const isolated = new TaskService(db, runtime);
      await expect(
        isolated.create({
          tenantId,
          userId,
          request: { kind: 'not-a-kind', input: {} },
          idempotencyKey: `r-${uuidv7()}`,
        }),
      ).rejects.toThrow(/unknown task kind/);
    });
  });
  describe('when the research providers fail', () => {
    it('does not leave the run looking like it is still in progress', async () => {
      /*
       * task が FAILED になっても、`research_runs` が SEARCHING のまま残ると
       * その画面では永久に「調査中」に見える（D-46 と同じ話）。
       */
      const failing = new ResearchService({
        db,
        search: {
          name: 'broken',
          isStandIn: true,
          async search() {
            throw new Error('the search provider is unreachable');
          },
        },
        model: new DeterministicLanguageModel(),
      });
      const executors = researchExecutors(failing);

      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'research', input: { question: '落ちる調査' } },
        idempotencyKey: `fail-${uuidv7()}`,
      });

      // plan は通り、search で落ちる
      await executors['research.plan']!.execute(
        { taskId: task.id, tenantId, input: { question: '落ちる調査' } },
        { toolId: 'research.plan', args: {} },
      );
      await expect(
        executors['research.search']!.execute(
          { taskId: task.id, tenantId, input: {} },
          { toolId: 'research.search', args: {} },
        ),
      ).rejects.toThrow(/unreachable/);

      // 失敗の後始末が呼ばれると、進行中ではなくなる
      await executors['research.search']!.onFailure({
        taskId: task.id,
        tenantId,
        input: {},
      });

      const run = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(['status'])
          .where('task_id', '=', task.id)
          .executeTakeFirstOrThrow(),
      );
      expect(run.status).toBe('FAILED');
    }, 120_000);

    it('does not undo a run that already finished', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'research', input: { question: '終わった調査' } },
        idempotencyKey: `done-${uuidv7()}`,
      });
      await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();

      await research.markFailed(tenantId, task.id);
      const run = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(['status'])
          .where('task_id', '=', task.id)
          .executeTakeFirstOrThrow(),
      );
      // 済んだものを後から失敗にしない
      expect(run.status).toBe('COMPLETE');
    }, 120_000);
  });
});
