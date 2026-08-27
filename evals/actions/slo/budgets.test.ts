/**
 * UX Performance SLO。正本 §23、UI/UX §23。
 *
 * ここで守りたいのは **数字そのものより、数字の扱い**:
 *
 *   - 代役を挟んで速く見えるものを「守れている」と言わない
 *   - 測ったものは、実プロセスを通して測る
 *   - 測っていないものは、なぜ測っていないかを残す
 *
 * `MEASURED` に載っているものは、ここか Phase 0 の受け入れで
 * 実際に時間を見ている。載っていないものは `WHY_NOT_MEASURED` に理由がある。
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
  MEASURED,
  SLO_TARGETS,
  WHY_NOT_MEASURED,
  p95,
  uuidv7,
  withinBudget,
  type SloName,
  type Task,
  type TokenResponse,
} from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { WorldModelService } from '@astra/service-world-model';
import { TaskService, TemporalTaskRuntime, createTaskWorker } from '@astra/service-task';
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
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const TASK_QUEUE = 'astra.task.slo';

/** 標本数。1 回の測定で判断しない。 */
const SAMPLES = 5;

/**
 * 予算を見るときの標本数。
 *
 * **外れ値 1 つで結論を変えない**ために多めに取る。
 * 20 標本の p95 は 19 番目なので、いちばん遅い 1 回が落ちる。
 */
const BUDGET_SAMPLES = 20;

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

const CORPUS: SearchHit[] = [
  {
    url: 'https://official.example.com/ir',
    title: 'IR',
    snippet: '売上は 100 億円でした',
    publisher: 'Example Inc',
    publishedAt: '2026-08-01T00:00:00.000Z',
    sourceType: 'official',
  },
];

describe('how the SLO table is kept honest', () => {
  it('accounts for every target', () => {
    for (const name of Object.keys(SLO_TARGETS) as SloName[]) {
      const measured = MEASURED.includes(name);
      const excused = WHY_NOT_MEASURED[name] !== undefined;
      // 測るか、なぜ測らないかを言うか。どちらでもない状態を作らない。
      expect(measured !== excused).toBe(true);
    }
  });

  it('does not claim a budget it only checked against a stand-in', () => {
    // 代役を挟むと数字の意味が変わるものは、載せない
    for (const name of [
      'textFirstToken',
      'localSttFirstPartial',
      'meetingLiveTranscript',
      'translationAfterSegment',
      'firstResearchEvidence',
    ] as SloName[]) {
      expect(MEASURED).not.toContain(name);
    }
  });
});

describe.skipIf(!url)('what we do measure, through the real process', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let app: App;
  let storeRoot: string;
  let auth: { authorization: string };

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-slo',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-slo-'));
    const library = new LibraryService(db, new FsObjectStore(storeRoot));

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
        requesterSalt: 'slo-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'slo', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'slo' }),
      }),
      tasks: new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE)),
      library,
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      // Home の brief を出す先。無いと /v1/brief 自体が生えない。
      world: new WorldModelService({ db }),
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `slo-${uuidv7()}@example.com`, display_name: '計測' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  /**
   * §23「長い調査を受け付けたと伝えるまで < 1s」。
   *
   * ここは代役が入らない。HTTP・DB・Temporal の起動まで**全部本物**なので、
   * 測った数字がそのまま意味を持つ。
   */
  it('acknowledges a long research within the budget', async () => {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const started = performance.now();
      const created = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: { ...auth, 'idempotency-key': `slo-${uuidv7()}` },
        payload: { kind: 'research', input: { question: 'A社の売上は' } },
      });
      const elapsed = performance.now() - started;

      // 受け付けたことを、結果を待たずに伝える
      expect(created.statusCode).toBe(202);
      expect(created.json<Task>().status).toBe('PENDING');
      samples.push(elapsed);
    }

    const target = SLO_TARGETS.researchAcknowledgement;
    // kind が max なので、いちばん遅かったものを見る
    const worst = Math.max(...samples);
    expect(
      withinBudget({ name: 'researchAcknowledgement', elapsedMs: worst }),
      `受付までの最悪値 ${worst.toFixed(0)}ms が ${target.budgetMs}ms を超えた`,
    ).toBe(true);
  }, 120_000);

  /**
   * §23「Home が手元の内容で出るまで < 300ms」の**サーバ側だけ**。
   *
   * これは SLO そのものではない（描画が入らないため `MEASURED` に載せない）。
   * ここで見たいのは 1 つだけ:
   * **サーバが予算を食い潰していないこと。**
   * 応答に 300ms 使ってしまうと、画面側に残る余地が無くなる。
   */
  it('leaves the client enough of the Home budget', async () => {
    const budget = SLO_TARGETS.homeCachedLoad.budgetMs;
    // サーバの取り分は予算の 1/3 まで。残りを描画に残す。
    const serverShare = budget / 3;

    /*
     * 1 回目は接続の確立と問い合わせ計画の作成を含む。
     * **利用者が Home を開くころには、それは済んでいる。**
     * ここで見たいのは定常の取り分なので、温めてから測る
     * （温めたことを黙ると、数字が何を指すのか分からなくなる）。
     */
    const warmUp = await app.inject({ method: 'GET', url: '/v1/brief', headers: auth });
    expect(warmUp.statusCode).toBe(200);

    /*
     * 標本を多めに取り、p95 で見る。
     *
     * 5 標本の最悪値で見ていた間、**実質「1 回の測定で判断」していた。**
     * 他のスイートと DB を共有していると外れ値が 1 つ混じり、
     * 予算とは無関係に落ちる。落ちる試験は、いずれ無視される。
     */
    const samples: number[] = [];
    for (let i = 0; i < BUDGET_SAMPLES; i += 1) {
      const started = performance.now();
      const res = await app.inject({ method: 'GET', url: '/v1/brief', headers: auth });
      samples.push(performance.now() - started);
      expect(res.statusCode).toBe(200);
    }

    const measured = p95(samples)!;
    expect(
      measured,
      `温めたあとの brief の p95 ${measured.toFixed(0)}ms が、サーバの取り分 ${serverShare}ms を超えた（最悪値 ${Math.max(...samples).toFixed(0)}ms）`,
    ).toBeLessThanOrEqual(serverShare);
    // それでも SLO を守れているとは言わない
    expect(MEASURED).not.toContain('homeCachedLoad');
  }, 120_000);

  /**
   * p95 の出しかたそのもの。
   *
   * **標本が無いときに 0 を返さない。**0 は「速かった」に見えるので、
   * 測っていないことを速いことと取り違える。
   */
  it('reports no p95 at all when nothing was sampled', () => {
    expect(p95([])).toBeNull();
    expect(p95([10, 20, 30])).toBeGreaterThan(0);
  });
});
