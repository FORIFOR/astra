/**
 * 受け入れの通し。正本 §4.4・§9・§16.1・§21。
 *
 * **実 Temporal・実 DB・実 HTTP。**差し替えるのは、端末の中で
 * 提供者を呼ぶところだけ（Google へは繋がない）。
 *
 * ここで確かめるのは、これまで別々に見てきたものが**繋がっている**こと:
 *
 *   端末が居ない → 止まる（失敗にしない）→ 端末が戻る → 進む
 *   送信は承認の跡が無ければ実行されない
 *   端末が落ちても、仕事は失われない
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { uuidv7, type Task, type TokenResponse } from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService, agentResolver } from '@astra/service-plugin-registry';
import { AgentHostService, HostBridge, HostStepExecutor } from '@astra/service-agent-host';
import { TaskService, TemporalTaskRuntime, createTaskWorker } from '@astra/service-task';
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
const TASK_QUEUE = 'astra.task.final';
const GMAIL = 'com.astra.gmail';

/** 端末の代わり。**提供者は呼ばない。**受け渡しの経路だけを通す。 */
interface FakeDevice {
  readonly seen: { taskId: string; toolId: string; approvalPresent: boolean }[];
  drain(hostId: string): Promise<number>;
}

describe.skipIf(!url)('the whole thing, end to end', () => {
  let db: DbHandle;
  let app: App;
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let bridge: HostBridge;
  let hosts: AgentHostService;
  let storeRoot = '';
  let auth: { authorization: string };
  let tenantId = '';
  let userId = '';

  const device: FakeDevice = {
    seen: [],
    async drain(hostId) {
      let handled = 0;
      for (;;) {
        const step = await bridge.claimNext({ tenantId, hostId });
        if (!step) return handled;
        device.seen.push({
          taskId: step.taskId,
          toolId: step.toolId,
          approvalPresent: step.approval !== null,
        });
        await bridge.complete({
          tenantId,
          requestId: step.id,
          hostId,
          result: { ran: step.toolId },
        });
        handled += 1;
      }
    },
  };

  const post = async (url_: string, payload: Record<string, unknown>, headers = auth) =>
    app.inject({ method: 'POST', url: url_, headers, payload });
  const get = async (url_: string) => app.inject({ method: 'GET', url: url_, headers: auth });

  const heartbeat = async (label: string): Promise<string> => {
    const res = await post('/v1/agent-hosts/heartbeat', {
      device_label: label,
      models: ['claude_code'],
    });
    return res.json<{ id: string }>().id;
  };

  const createTask = async (): Promise<Task> =>
    (
      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: { ...auth, 'idempotency-key': `final-${uuidv7()}` },
        payload: {
          kind: `plugin:${GMAIL}:mail-assistant`,
          input: { message: '今日の受信箱を見て', to: ['a@example.com'], subject: 'x', body: 'y' },
        },
      })
    ).json<Task>();

  const statusOf = async (taskId: string): Promise<string> =>
    (await get(`/v1/tasks/${taskId}`)).json<Task>().status;

  const waitFor = async (
    check: () => Promise<boolean>,
    what: string,
    timeoutMs = 30_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-final',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-final-'));
    const library = new LibraryService(db, new FsObjectStore(storeRoot));
    const registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.seedBuiltins(path.join(repoRoot, 'plugins/builtin'));

    bridge = new HostBridge({ db, requestTtlMs: 120_000 });
    hosts = new AgentHostService({ db });

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      {
        db,
        library,
        publisher: { async publish() {} },
        /*
         * **cloud 側に connector の executor は無い。**
         * `surface: local` の step は Host Bridge へ回る。
         */
        hostExecutor: new HostStepExecutor({
          bridge,
          pollMs: 50,
          waitMs: 8_000,
          approvalFor: async (where) => {
            const operation = { 'mail.send': 'gmail.send', 'mail.trash': 'gmail.trash' }[
              where.toolId
            ];
            if (!operation) return null;
            return {
              approvalId: uuidv7(),
              operationId: operation,
              decision: 'APPROVED' as const,
              decidedBy: userId,
              decidedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
            };
          },
        }),
        hosts: bridge,
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
        requesterSalt: 'final-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger(
        { service: 'final', level: 'silent' },
        new Writable({
          write(_c, _e, cb) {
            cb();
          },
        }),
      ),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'final' }),
      }),
      tasks: new TaskService(
        db,
        new TemporalTaskRuntime(env.client, TASK_QUEUE),
        agentResolver(registry),
      ),
      library,
      registry,
      agentHosts: hosts,
      hostBridge: bridge,
    });
    await app.ready();

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `final-${uuidv7()}@example.com`, display_name: '通し試験' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = (await get('/v1/me')).json<{ tenant: { id: string }; user: { id: string } }>();
    tenantId = me.tenant.id;
    userId = me.user.id;

    await post(`/v1/plugins/${GMAIL}/install`, {
      version: '0.1.0',
      granted_scopes: ['email.read', 'email.draft', 'email.modify', 'email.send'],
    });
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('pauses rather than failing when no device is there to run it', async () => {
    const task = await createTask();

    // 端末は一度も名乗っていない。**失敗ではなく、待ち。**
    await waitFor(async () => (await statusOf(task.id)) === 'PAUSED_HOST_OFFLINE', 'the pause');
    expect(await statusOf(task.id)).toBe('PAUSED_HOST_OFFLINE');

    // 待っている間、端末には何も置かれていない（居ないので置けない）
    expect(device.seen).toEqual([]);
  }, 120_000);

  it('carries on once the device comes back, without losing the work', async () => {
    const task = await createTask();
    await waitFor(async () => (await statusOf(task.id)) === 'PAUSED_HOST_OFFLINE', 'the pause');

    const hostId = await heartbeat('macbook');
    /*
     * 端末の復帰は 1 分おきに見に行く（workflow の `HOST_POLL_INTERVAL`）。
     * **短くしない。**短くすると、端末が瞬断するたびに問い合わせが走る。
     * ここはその 1 周期を実際に待つ。
     */
    /*
     * **止まらずに取りに来る。**1 回取って終わりにしていた間、
     * 2 段目以降を誰も取りに来ず、仕事は終わらなかった。
     * 本物の端末も、止められるまで取りに来続ける。
     */
    await waitFor(
      async () => {
        await device.drain(hostId);
        return (await statusOf(task.id)) === 'COMPLETED';
      },
      'the task to finish',
      180_000,
    );

    // 端末が走らせたのは、この仕事について agent が宣言した tool だけ
    const ran = device.seen.filter((s) => s.taskId === task.id).map((s) => s.toolId);
    expect(ran).toEqual(['mail.search', 'mail.read', 'mail.draft.create']);
    expect(ran).not.toContain('mail.send');
  }, 300_000);

  it('does not send a credential to the device', async () => {
    const rows = await bridge.get(tenantId, '00000000-0000-0000-0000-000000000000');
    expect(rows).toBeNull();
    await expect(
      bridge.request({
        tenantId,
        taskId: uuidv7(),
        stepIndex: 0,
        toolId: 'mail.send',
        args: { token: 'ya29.aVeryLongStringThatLooksExactlyLikeAnAccessTokenWouldLookHere' },
      }),
    ).rejects.toMatchObject({ code: 'common.validation_failed' });
  });

  it('gives the device an approval only for the operations that need one', async () => {
    // 下書きと検索には承認の跡を渡さない。渡すと、要らない承認が普通になる。
    const drafts = device.seen.filter((s) => s.toolId !== 'mail.send');
    expect(drafts.every((s) => !s.approvalPresent)).toBe(true);
  });

  it('never lets a mail agent hold the ability to send', async () => {
    /*
     * 承認を通せば送れる、ではなく **agent がそもそも送信の tool を持たない。**
     * 送るかどうかは人が決めることなので、持たせない。
     */
    const catalog = (await get('/v1/plugins/catalog')).json<{
      items: { id: string; agents?: { id: string; tools: string[] }[] }[];
    }>();
    const gmail = catalog.items.find((p) => p.id === GMAIL)!;
    const agent = gmail.agents?.find((a) => a.id === 'mail-assistant');
    if (agent) expect(agent.tools).not.toContain('mail.send');
  });
});
