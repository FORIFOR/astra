/**
 * install した plugin の agent が、コード変更なしに走る。
 * Phase 5 実装仕様 §2。AC5-1 〜 AC5-6。
 *
 * Phase 4 の AC4-2 は `installed: true` しか見ておらず、
 * 「agent が使えるようになった」ことを確かめていなかった。ここで閉じる。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { AstraError, sha256Hex, uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, withSystem, withTenant, type DbHandle } from '@astra/db';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService, agentResolver } from '@astra/service-plugin-registry';
import {
  generatePublisherKeyPair,
  loadManifest,
  signManifest,
  type PluginAsset,
} from '@astra/plugin-sdk';
import {
  TaskService,
  TemporalTaskRuntime,
  agentKindFor,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const TASK_QUEUE = 'astra.task.agent-test';
const PLUGIN_ID = 'com.agentest.crm';
const PUBLISHER = 'agentest';
const SKILL = '# CRM Analyst\n\n根拠のない断定をしない。';

describe.skipIf(!url)('an installed agent', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let registry: PluginRegistryService;
  let tasks: TaskService;
  let library: LibraryService;
  let storeRoot: string;
  /** step が実際に受け取った引数。skill が届いているかを見る。 */
  const seen: { toolId: string; args: Record<string, unknown> }[] = [];

  const tenantId = uuidv7();
  const userId = uuidv7();
  const keys = generatePublisherKeyPair();

  const manifestFor = async (version: string) => {
    const base = {
      id: PLUGIN_ID,
      name: 'CRM Analyst',
      version,
      publisher: PUBLISHER,
      verified: false,
      min_core_version: '0.1.0',
      category: 'domain-agent',
      compliance_profile: 'GENERAL',
      execution_surfaces: ['cloud'],
      permissions: ['artifacts.read', 'artifacts.write'],
      data_accessed: ['この利用者が既に見られる商談'],
      tools: [
        // 落ちたら summarize で続ける（正本 §24 の alternate connector）
        { id: 'crm.search', risk: 'READ', surface: 'cloud', fallbacks: ['crm.summarize'] },
        { id: 'crm.summarize', risk: 'READ', surface: 'cloud' },
      ],
      agents: [
        { id: 'analyst', skill: 'skills/analyst.md', tools: ['crm.search', 'crm.summarize'] },
      ],
    };
    const unsigned = await loadManifest(base, 'agent-e2e');
    return loadManifest(
      { ...base, signature: signManifest(unsigned.canonical, keys.privateKey) },
      'agent-e2e',
    );
  };

  const skillAsset = async (): Promise<PluginAsset[]> => {
    const content = Buffer.from(SKILL);
    return [
      { path: 'skills/analyst.md', kind: 'skill', content, sha256: await sha256Hex(content) },
    ];
  };

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-agent-e2e',
    });

    await withIdentity(db, async (tx) => {
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: 'A', kind: 'personal' })
        .execute();
      await tx
        .insertInto('users')
        .values({ id: userId, email: `ag-${userId}@example.com`, display_name: 'A' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });
    await withSystem(db, (tx) =>
      tx
        .insertInto('plugin_publishers')
        .values({
          id: PUBLISHER,
          display_name: 'Agent Test',
          public_key: keys.publicKey,
          verified: false,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute(),
    );

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-agent-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));
    registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.publish(await manifestFor('1.0.0'), await skillAsset());

    // plugin が持ち込んだ tool の中身。**core はこれを知らない。**
    const executor = (toolId: string) => ({
      async execute(_input: unknown, step: { toolId: string; args: Record<string, unknown> }) {
        seen.push({ toolId, args: step.args });
        // 失敗経路を試すための合図。実際の tool は落ちるものなので、
        // 落ちたときに何が残るかを確かめておく必要がある。
        // BOOM   … crm.search だけ落ちる（代替で続くはず）
        // BOOM-ALL … すべて落ちる（代替も無い状態を作る）
        const request = step.args['request'];
        if (request === 'BOOM-ALL') throw new Error('the CRM refused the request');
        if (request === 'BOOM' && toolId === 'crm.search') {
          throw new Error('the CRM refused the request');
        }
        return {
          result: { tool: toolId },
          detail: null,
          ...(toolId === 'crm.summarize'
            ? { artifact: { title: '商談まとめ', markdown: '# 商談まとめ\n\n3 件' } }
            : {}),
        };
      },
    });

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      {
        db,
        library,
        publisher: { async publish() {} },
        executors: {
          'crm.search': executor('crm.search'),
          'crm.summarize': executor('crm.summarize'),
        },
      },
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

    tasks = new TaskService(
      db,
      new TemporalTaskRuntime(env.client, TASK_QUEUE),
      agentResolver(registry),
    );
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  /** 承認が現れるまで待つ。現れなければ null。 */
  const waitForApproval = async (taskId: string): Promise<string | null> => {
    for (let i = 0; i < 100; i += 1) {
      const row = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('approvals')
          .select(['id'])
          .where('task_id', '=', taskId)
          .where('status', '=', 'PENDING')
          .executeTakeFirst(),
      );
      if (row) return row.id;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  const run = async (kind: string) => {
    const { task } = await tasks.create({
      tenantId,
      userId,
      request: { kind, input: { message: '今月の商談を分析して' } },
      idempotencyKey: `ag-${uuidv7()}`,
    });
    await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();
    return tasks.get(tenantId, task.id);
  };

  it('AC5-6: cannot be run before the plugin is installed', async () => {
    await expect(
      tasks.create({
        tenantId,
        userId,
        request: { kind: agentKindFor(PLUGIN_ID, 'analyst'), input: {} },
        idempotencyKey: `ag-${uuidv7()}`,
      }),
    ).rejects.toThrow(/unknown task kind/);
  });

  it('AC5-3: refuses to start when a required scope was not granted', async () => {
    await registry.install(tenantId, userId, PLUGIN_ID, {
      version: '1.0.0',
      granted_scopes: ['artifacts.read'],
    });

    await expect(
      tasks.create({
        tenantId,
        userId,
        request: { kind: agentKindFor(PLUGIN_ID, 'analyst'), input: {} },
        idempotencyKey: `ag-${uuidv7()}`,
      }),
    ).rejects.toThrow(/artifacts.write/);
  });

  it('AC5-1 / AC5-2 / AC5-5: runs the agent using only its declared tools', async () => {
    await registry.install(tenantId, userId, PLUGIN_ID, {
      version: '1.0.0',
      granted_scopes: ['artifacts.read', 'artifacts.write'],
    });
    seen.length = 0;

    const done = await run(agentKindFor(PLUGIN_ID, 'analyst'));
    expect(done.status).toBe('COMPLETED');

    // core に kind を足していない。install した宣言から計画が立った。
    expect(seen.map((s) => s.toolId)).toEqual(['crm.search', 'crm.summarize']);
    // skill は実体ファイルから読まれて step へ届く（AC5-5）
    expect(String(seen[0]!.args['skill'])).toContain('根拠のない断定をしない');
    expect(seen[0]!.args['request']).toBe('今月の商談を分析して');

    const artifact = await library.findBySourceTask(tenantId, done.id);
    expect(artifact).not.toBeNull();
  }, 120_000);

  it('AC5-6: stops being runnable once the plugin is uninstalled', async () => {
    await registry.uninstall(tenantId, userId, PLUGIN_ID);
    await expect(
      tasks.create({
        tenantId,
        userId,
        request: { kind: agentKindFor(PLUGIN_ID, 'analyst'), input: {} },
        idempotencyKey: `ag-${uuidv7()}`,
      }),
    ).rejects.toThrow(/unknown task kind/);
  });

  it('makes a regulated write wait for approval, where a general one would not', async () => {
    // 一度壊れていた経路。complianceProfile が固定値だった間、
    // 規制区分の plugin も一般として評価されていた（正本 §22）。
    const CARE_ID = 'com.agentest.care';
    const base = {
      id: CARE_ID,
      name: 'Care Assistant',
      version: '1.0.0',
      publisher: PUBLISHER,
      verified: false,
      min_core_version: '0.1.0',
      category: 'domain-agent',
      compliance_profile: 'CARE',
      execution_surfaces: ['cloud'],
      permissions: [],
      data_accessed: ['Care records this user already has access to'],
      // REVERSIBLE_WRITE は一般なら確認不要。規制区分では確認が要る。
      tools: [{ id: 'care.note', risk: 'REVERSIBLE_WRITE', surface: 'cloud' }],
      agents: [{ id: 'assistant', skill: 'skills/analyst.md', tools: ['care.note'] }],
      // 規制 profile は policies 必須（manifest の不変条件）
      policies: ['policies/care.yaml'],
    };
    const unsigned = await loadManifest(base, 'care-e2e');
    const manifest = await loadManifest(
      { ...base, signature: signManifest(unsigned.canonical, keys.privateKey) },
      'care-e2e',
    );
    // 規制 plugin は、実際に効く規則を持っていなければ publish できない
    const policy = Buffer.from(
      [
        'id: care',
        'rules:',
        '  - id: confirm-writes',
        '    description: ケア記録への書き込みは確認を取る',
        '    when: { when: risk_at_least, risk: REVERSIBLE_WRITE }',
        '    require: confirmation',
        '    severity: block',
        '',
      ].join('\n'),
    );
    await registry.publish(manifest, [
      ...(await skillAsset()),
      {
        path: 'policies/care.yaml',
        kind: 'policy',
        content: policy,
        sha256: await sha256Hex(policy),
      },
    ]);
    await registry.install(tenantId, userId, CARE_ID, { version: '1.0.0', granted_scopes: [] });

    const { task } = await tasks.create({
      tenantId,
      userId,
      request: { kind: agentKindFor(CARE_ID, 'assistant'), input: { message: '記録する' } },
      idempotencyKey: `care-${uuidv7()}`,
    });

    // 承認待ちで止まる。走り切らない。
    const pending = await waitForApproval(task.id);
    expect(pending).not.toBeNull();

    const running = await tasks.get(tenantId, task.id);
    expect(running.status).toBe('WAITING_APPROVAL');
  }, 120_000);

  it('will not quietly run a local tool in the cloud', async () => {
    // `surface` は正本 §16 の local-first の境界そのもの。
    // Host Bridge へ回す経路が繋がるまでは、実行せずに失敗させる。
    const LOCAL_ID = 'com.agentest.local';
    const base = {
      id: LOCAL_ID,
      name: 'Finder',
      version: '1.0.0',
      publisher: PUBLISHER,
      verified: false,
      min_core_version: '0.1.0',
      category: 'connector',
      compliance_profile: 'GENERAL',
      execution_surfaces: ['local'],
      permissions: [],
      data_accessed: ['Files the user picked'],
      tools: [{ id: 'finder.search', risk: 'READ', surface: 'local' }],
      agents: [{ id: 'finder', skill: 'skills/analyst.md', tools: ['finder.search'] }],
    };
    const unsigned = await loadManifest(base, 'local-e2e');
    const manifest = await loadManifest(
      { ...base, signature: signManifest(unsigned.canonical, keys.privateKey) },
      'local-e2e',
    );
    await registry.publish(manifest, await skillAsset());
    await registry.install(tenantId, userId, LOCAL_ID, { version: '1.0.0', granted_scopes: [] });

    seen.length = 0;
    const { task } = await tasks.create({
      tenantId,
      userId,
      request: { kind: agentKindFor(LOCAL_ID, 'finder'), input: {} },
      idempotencyKey: `local-${uuidv7()}`,
    });
    // ワークフローは失敗する。失敗そのものは想定どおり。
    await expect(
      env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result(),
    ).rejects.toThrow();

    // クラウドで代わりに走らせない
    expect(seen).toEqual([]);
    // **宙ぶらりんにしない。**RUNNING のまま残ると、誰も気づけない
    const done = await tasks.get(tenantId, task.id);
    expect(done.status).toBe('FAILED');
    expect(done.error?.message ?? '').toContain('local');
  }, 120_000);

  it('does not leave a task running when a tool simply fails', async () => {
    /*
     * local surface に限らない一般の話。ここを素通しにしていた間、
     * tool が失敗するとワークフローだけが落ち、`tasks` の行は RUNNING の
     * まま残っていた。Work タブでは永久に「進行中」に見える。
     */
    // 前のテストが uninstall しているので、ここで入れ直す（順序に頼らない）
    await registry.install(tenantId, userId, PLUGIN_ID, {
      version: '1.0.0',
      granted_scopes: ['artifacts.read', 'artifacts.write'],
    });

    const { task } = await tasks.create({
      tenantId,
      userId,
      request: { kind: agentKindFor(PLUGIN_ID, 'analyst'), input: { message: 'BOOM-ALL' } },
      idempotencyKey: `boom-${uuidv7()}`,
    });
    await expect(
      env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result(),
    ).rejects.toThrow();

    const done = await tasks.get(tenantId, task.id);
    expect(done.status).toBe('FAILED');
    // **何も言っていないエラーを残さない。**理由まで降りていること
    expect(done.error?.message ?? '').toContain('the CRM refused the request');
    expect(done.error?.step_index).toBe(0);
    // 何をすれば直るかを言う（正本 §24）
    expect(done.error?.recovery).toBe('handoff');
  }, 120_000);

  it('tries the alternate the plugin declared before giving up (正本 §24)', async () => {
    await registry.install(tenantId, userId, PLUGIN_ID, {
      version: '1.0.0',
      granted_scopes: ['artifacts.read', 'artifacts.write'],
    });
    seen.length = 0;

    // crm.search だけが落ちる。宣言された代替（crm.summarize）で続くはず。
    const { task } = await tasks.create({
      tenantId,
      userId,
      request: { kind: agentKindFor(PLUGIN_ID, 'analyst'), input: { message: 'BOOM' } },
      idempotencyKey: `fallback-${uuidv7()}`,
    });
    await env.client.workflow.getHandle(workflowIdFor(tenantId, task.id)).result();

    const done = await tasks.get(tenantId, task.id);
    // 代替で続いたので、落ちずに終わる
    expect(done.status).toBe('COMPLETED');
    // search が落ち、summarize が代わりに呼ばれ、そのあと本来の summarize も走る
    expect(seen.filter((s) => s.toolId === 'crm.summarize').length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('refuses an agent id the plugin never declared', async () => {
    await registry.install(tenantId, userId, PLUGIN_ID, {
      version: '1.0.0',
      granted_scopes: ['artifacts.read', 'artifacts.write'],
    });
    await expect(
      tasks.create({
        tenantId,
        userId,
        request: { kind: agentKindFor(PLUGIN_ID, 'nope'), input: {} },
        idempotencyKey: `ag-${uuidv7()}`,
      }),
    ).rejects.toThrow(AstraError);
  });
});
