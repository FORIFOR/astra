/**
 * Local Agent Host の通し。正本 §4.4・§16.1。
 *
 * **実 HTTP を叩く。**契約だけでなく、経路として繋がっていることを見る。
 *
 * 確認するのは:
 *   - 二重実行しない
 *   - 仕事を失わない
 *   - 承認を飛ばさない
 *   - 端末が落ちても FAILED にしない
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST_OFFLINE_AFTER_MS, uuidv7, type Task, type TokenResponse } from '@astra/contracts';
import { withTenant } from '@astra/db';
import { AgentHostService } from '@astra/service-agent-host';
import {
  makeTestApp,
  makeTokens,
  testDbConfig,
  type TestApp,
} from '../../../services/api-gateway/test/support.js';
import type { App } from '../../../services/api-gateway/src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('the work survives the window closing', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };
  let tenantId: string;
  let hostId: string;

  const createTask = async (): Promise<Task> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { ...auth, 'idempotency-key': `host-${uuidv7()}` },
      payload: { kind: 'echo', input: { message: 'long work' } },
    });
    return res.json<Task>();
  };

  const heartbeat = async (label: string): Promise<{ id: string }> =>
    (
      await app.inject({
        method: 'POST',
        url: '/v1/agent-hosts/heartbeat',
        headers: auth,
        payload: { device_label: label, models: ['claude_code'] },
      })
    ).json<{ id: string }>();

  beforeAll(async () => {
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens: await makeTokens(),
    });
    app = harness.app;
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `host-${uuidv7()}@example.com`, display_name: 'ホスト' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    tenantId = (await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json<{
      tenant: { id: string };
    }>().tenant.id;
    hostId = (await heartbeat('macbook')).id;
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('registers the device once, however often it says hello', async () => {
    const again = await heartbeat('macbook');
    expect(again.id).toBe(hostId);

    const listed = (
      await app.inject({ method: 'GET', url: '/v1/agent-hosts', headers: auth })
    ).json<{ items: { id: string; state: string }[] }>();
    expect(listed.items.some((h) => h.id === hostId && h.state === 'online')).toBe(true);
  });

  it('will not lease the same job to two devices', async () => {
    const task = await createTask();
    const other = await heartbeat('other-mac');

    const first = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/lease`,
      headers: auth,
      payload: { host_id: hostId },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/lease`,
      headers: auth,
      payload: { host_id: other.id },
    });
    // 二重に走らせると、外部への操作が二度起きる
    expect(second.statusCode).toBe(409);
  });

  it('keeps the progress so a sleep does not restart the work', async () => {
    const task = await createTask();
    const lease = (
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/lease`,
        headers: auth,
        payload: { host_id: hostId },
      })
    ).json<{ leaseId: string }>();

    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/checkpoint`,
      headers: auth,
      payload: { lease_id: lease.leaseId, step_index: 2, state: { searched: ['a', 'b'] } },
    });

    const saved = (
      await app.inject({
        method: 'GET',
        url: `/v1/tasks/${task.id}/checkpoint`,
        headers: auth,
      })
    ).json<{ stepIndex: number; state: Record<string, unknown> }>();
    expect(saved.stepIndex).toBe(2);
    expect(saved.state).toEqual({ searched: ['a', 'b'] });
  });

  it('says there is no checkpoint rather than pretending it is at zero', async () => {
    const task = await createTask();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${task.id}/checkpoint`,
      headers: auth,
    });
    // 空を返すと「0 まで進んだ」と読まれる
    expect(res.statusCode).toBe(404);
  });

  it('refuses a write from a lease that was taken away', async () => {
    const task = await createTask();
    const stale = (
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/lease`,
        headers: auth,
        payload: { host_id: hostId },
      })
    ).json<{ leaseId: string }>();

    // 同じ host が取り直す（再起動に相当）。古い lease は無効になる
    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/lease`,
      headers: auth,
      payload: { host_id: hostId },
    });

    const late = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/checkpoint`,
      headers: auth,
      payload: { lease_id: stale.leaseId, step_index: 9, state: {} },
    });
    expect(late.statusCode).toBe(409);
  });

  it('pauses instead of failing when the device disappears', async () => {
    const task = await createTask();
    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/lease`,
      headers: auth,
      payload: { host_id: hostId },
    });
    await withTenant(harness.db, tenantId, (tx) =>
      tx.updateTable('tasks').set({ status: 'RUNNING' }).where('id', '=', task.id).execute(),
    );

    /*
     * host を殺す。**heartbeat が止まった状態**を作るため、
     * 最後の応答を過去へずらす（プロセスを落とすのと同じ意味）。
     */
    await withTenant(harness.db, tenantId, (tx) =>
      tx
        .updateTable('agent_hosts')
        .set({ last_seen_at: new Date(Date.now() - HOST_OFFLINE_AFTER_MS - 5_000) })
        .where('id', '=', hostId)
        .execute(),
    );

    const service = new AgentHostService({ db: harness.db });
    const paused = await service.pauseOrphaned(tenantId);
    expect(paused).toContain(task.id);

    const after = (
      await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}`, headers: auth })
    ).json<Task>();
    // **FAILED にしない。**待てば戻る
    expect(after.status).toBe('PAUSED_HOST_OFFLINE');
    // 進行中として見せる（失敗の面だと「やり直せ」と読まれる）
    expect((after as unknown as { dock_state: string }).dock_state).toBe('WORKING');
  });

  it('resumes once the device comes back', async () => {
    const task = await createTask();
    await withTenant(harness.db, tenantId, (tx) =>
      tx
        .updateTable('tasks')
        .set({ status: 'PAUSED_HOST_OFFLINE' })
        .where('id', '=', task.id)
        .execute(),
    );
    await heartbeat('macbook');

    const resumed = (
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/resume`,
        headers: auth,
        payload: { host_id: hostId },
      })
    ).json<{ resumed: boolean }>();
    expect(resumed.resumed).toBe(true);

    const after = (
      await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}`, headers: auth })
    ).json<Task>();
    expect(after.status).toBe('RUNNING');
  });

  it('does not walk past an approval that was waiting', async () => {
    const task = await createTask();
    await withTenant(harness.db, tenantId, (tx) =>
      tx
        .updateTable('tasks')
        .set({ status: 'WAITING_APPROVAL' })
        .where('id', '=', task.id)
        .execute(),
    );

    const outcome = (
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/resume`,
        headers: auth,
        payload: { host_id: hostId },
      })
    ).json<{ resumed: boolean; reason: string }>();

    // 止まっている間に前提が変わっていることがある
    expect(outcome.resumed).toBe(false);
    expect(outcome.reason).toContain('確認');
  });

  it('hides another tenant behind 404', async () => {
    const task = await createTask();
    const outsider = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `out-${uuidv7()}@example.com`, display_name: 'O' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/lease`,
      headers: { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` },
      payload: { host_id: hostId },
    });
    expect(res.statusCode).toBe(404);
  });
});
