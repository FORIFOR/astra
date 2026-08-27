/**
 * 窓を閉じても、仕事は続く。正本 §4.4・§16.1、UI/UX §4.4。
 *
 *   調査を始める →Dock を閉じる →Host は動き続ける
 *   →Dock を開き直す →結果が戻っている
 *
 * **Dock は窓であって、実行基盤ではない。**
 * ここで確かめるのは「閉じたのが窓だけ」であること。
 *
 * Dock の終了は、この試験では**その process が居なくなること**で表す。
 * Dock は HTTP の client でしかないので、居なくなっても
 * サーバ側の記録と Host の貸し出しは何も変わらないはず — それを見る。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type Task, type TokenResponse } from '@astra/contracts';
import { withTenant } from '@astra/db';
import { AgentHostService, HostBridge } from '@astra/service-agent-host';
import {
  makeTestApp,
  makeTokens,
  testDbConfig,
  type TestApp,
} from '../../../services/api-gateway/test/support.js';
import type { App } from '../../../services/api-gateway/src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('closing the window does not stop the work', () => {
  let harness: TestApp;
  let app: App;
  let hosts: AgentHostService;
  let bridge: HostBridge;
  let auth: { authorization: string };
  let tenantId = '';
  let userId = '';
  let hostId = '';

  /** Dock がやること: 仕事を頼み、様子を見る。**実行はしない。** */
  const dock = {
    async start(): Promise<Task> {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: { ...auth, 'idempotency-key': `bg-${uuidv7()}` },
        payload: { kind: 'research', input: { question: 'A社の競合は？' } },
      });
      return res.json<Task>();
    },
    async look(taskId: string): Promise<Task> {
      return (
        await app.inject({ method: 'GET', url: `/v1/tasks/${taskId}`, headers: auth })
      ).json<Task>();
    },
  };

  beforeAll(async () => {
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens: await makeTokens(),
    });
    app = harness.app;
    hosts = new AgentHostService({ db: harness.db });
    bridge = new HostBridge({ db: harness.db });

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `bg-${uuidv7()}@example.com`, display_name: '継続試験' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json<{
      tenant: { id: string };
      user: { id: string };
    }>();
    tenantId = me.tenant.id;
    userId = me.user.id;

    hostId = (
      await hosts.heartbeat({
        tenantId,
        userId,
        deviceLabel: 'macbook',
        models: ['claude_code'],
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('keeps the job with the device while the window is shut', async () => {
    const task = await dock.start();
    const lease = await hosts.claim({ tenantId, taskId: task.id, hostId });

    /*
     * ここで Dock が閉じる。**client が居なくなるだけ。**
     * 貸し出しも、途中経過も、サーバ側の記録も動かない。
     */
    await hosts.checkpoint({
      tenantId,
      taskId: task.id,
      leaseId: lease.leaseId,
      stepIndex: 2,
      state: { sourcesFound: 7 },
    });

    // Dock が居ない間も、Host は借りたままでいられる
    expect(await hosts.isLeaseValid(tenantId, task.id, lease.leaseId)).toBe(true);
    const renewed = await hosts.renew({ tenantId, taskId: task.id, leaseId: lease.leaseId });
    expect(renewed.leaseId).toBe(lease.leaseId);
  });

  it('hands the work back when the window opens again', async () => {
    const task = await dock.start();
    const lease = await hosts.claim({ tenantId, taskId: task.id, hostId });
    await hosts.checkpoint({
      tenantId,
      taskId: task.id,
      leaseId: lease.leaseId,
      stepIndex: 4,
      state: { sourcesFound: 12, question: 'A社の競合は？' },
    });

    // Dock を開き直す。**続きから見える。**
    const seen = await dock.look(task.id);
    expect(seen.id).toBe(task.id);

    const checkpoint = await hosts.lastCheckpoint(tenantId, task.id);
    expect(checkpoint).toMatchObject({
      stepIndex: 4,
      state: { sourcesFound: 12 },
    });
  });

  it('does not restart the work from the beginning', async () => {
    const task = await dock.start();
    const lease = await hosts.claim({ tenantId, taskId: task.id, hostId });
    await hosts.checkpoint({
      tenantId,
      taskId: task.id,
      leaseId: lease.leaseId,
      stepIndex: 3,
      state: { sourcesFound: 9 },
    });

    // 端末が寝て、起きた
    await hosts.release({ tenantId, taskId: task.id, leaseId: lease.leaseId });
    const again = await hosts.claim({ tenantId, taskId: task.id, hostId });

    // 借り直しなので、別の貸し出しになる
    expect(again.leaseId).not.toBe(lease.leaseId);
    /*
     * **最初からやり直さない。**9 件集めた事実は、
     * 借り直しても消えない（途中経過は貸し出しと別に残る）。
     */
    expect((await hosts.lastCheckpoint(tenantId, task.id))!.stepIndex).toBe(3);
    expect((await hosts.lastCheckpoint(tenantId, task.id))!.state).toMatchObject({
      sourcesFound: 9,
    });
  });

  it('says there is no progress rather than pretending it is at zero', async () => {
    const task = await dock.start();
    // 一度も進んでいない仕事に、空の途中経過を返さない
    expect(await hosts.lastCheckpoint(tenantId, task.id)).toBeNull();
  });

  it('will not let a second window run the same job', async () => {
    const task = await dock.start();
    await hosts.claim({ tenantId, taskId: task.id, hostId });

    const other = (
      await hosts.heartbeat({
        tenantId,
        userId,
        deviceLabel: 'second-mac',
        models: ['claude_code'],
      })
    ).id;

    // 二重に走らせると、外部への操作が二度起きる
    await expect(hosts.claim({ tenantId, taskId: task.id, hostId: other })).rejects.toMatchObject({
      code: 'task.invalid_state',
    });
  });

  it('leaves nothing half-placed for the device when the window closes', async () => {
    const task = await dock.start();
    await bridge.request({
      tenantId,
      taskId: task.id,
      stepIndex: 0,
      toolId: 'mail.search',
      args: { query: 'is:unread' },
    });

    /*
     * Dock が閉じても、置いたものはそのまま。
     * **消すと、端末が既に走らせていた場合に「やっていない」ことになる。**
     */
    const placed = await withTenant(harness.db, tenantId, (tx) =>
      tx
        .selectFrom('host_step_requests')
        .select(['status'])
        .where('task_id', '=', task.id)
        .executeTakeFirst(),
    );
    expect(placed!.status).toBe('PENDING');

    // 端末は Dock と関係なく取りに来られる
    const claimed = await bridge.claimNext({ tenantId, hostId });
    expect(claimed).not.toBeNull();
  });
});
