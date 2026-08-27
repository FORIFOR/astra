/**
 * 手元でしか動かせない step が、端末まで届いて戻る道。
 * 正本 §2.4・§4.4・§16.1・§21。
 *
 * **実 HTTP を叩く。**契約が合っているだけでは、経路が繋がっている証拠にならない。
 *
 * 見るのは:
 *   - 二重に渡さない
 *   - 資格情報を運ばない
 *   - 失敗を成功として返さない
 *   - 端末が居ないときに、勝手に別の手段へ乗り換えない
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type Task, type TokenResponse } from '@astra/contracts';
import { HostBridge, HostStepExecutor, isHostOffline } from '@astra/service-agent-host';
import {
  makeTestApp,
  makeTokens,
  testDbConfig,
  type TestApp,
} from '../../../services/api-gateway/test/support.js';
import type { App } from '../../../services/api-gateway/src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('a step that only the device can run', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };
  let tenantId: string;
  let userId: string;
  let hostId: string;
  let bridge: HostBridge;

  const createTask = async (): Promise<Task> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { ...auth, 'idempotency-key': `bridge-${uuidv7()}` },
      payload: { kind: 'echo', input: { message: 'send it' } },
    });
    return res.json<Task>();
  };

  const heartbeat = async (label = 'macbook'): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/v1/agent-hosts/heartbeat',
        headers: auth,
        payload: { device_label: label, models: ['claude_code'] },
      })
    ).json<{ id: string }>().id;

  const claim = async (host = hostId) =>
    app.inject({
      method: 'POST',
      url: '/v1/host-steps/claim',
      headers: auth,
      payload: { host_id: host },
    });

  beforeAll(async () => {
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens: await makeTokens(),
    });
    app = harness.app;
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `bridge-${uuidv7()}@example.com`, display_name: '受け渡し試験' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json<{
      tenant: { id: string };
      user: { id: string };
    }>();
    tenantId = me.tenant.id;
    userId = me.user.id;
    bridge = new HostBridge({ db: harness.db });
    hostId = await heartbeat();
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('has nothing to hand out until something is placed', async () => {
    const res = await claim();
    // 「今は無い」は正常な答え。404 にすると端末側が失敗として扱う。
    expect(res.statusCode).toBe(204);
  });

  it('hands a placed step to the device and takes the result back', async () => {
    const task = await createTask();
    const placed = await bridge.request({
      tenantId,
      taskId: task.id,
      stepIndex: 0,
      toolId: 'mail.send',
      args: { to: ['a@example.com'], subject: '見積', body: 'よろしくお願いします。' },
    });

    const taken = await claim();
    expect(taken.statusCode).toBe(200);
    expect(taken.json<{ id: string; toolId: string }>()).toMatchObject({
      id: placed.id,
      toolId: 'mail.send',
    });

    const done = await app.inject({
      method: 'POST',
      url: `/v1/host-steps/${placed.id}/complete`,
      headers: auth,
      payload: { host_id: hostId, result: { messageId: 'm1' } },
    });
    expect(done.statusCode).toBe(204);
    expect(await bridge.get(tenantId, placed.id)).toMatchObject({
      status: 'DONE',
      result: { messageId: 'm1' },
    });
  });

  it('does not hand the same step to a second device', async () => {
    const task = await createTask();
    await bridge.request({
      tenantId,
      taskId: task.id,
      stepIndex: 0,
      toolId: 'mail.send',
      args: {},
    });

    const first = await claim();
    expect(first.statusCode).toBe(200);
    const second = await claim(await heartbeat('other-mac'));
    // もう渡さない。渡せば同じメールが二度送られる。
    expect(second.statusCode).toBe(204);
  });

  it('keeps a failure a failure, with something the person can act on', async () => {
    const task = await createTask();
    const placed = await bridge.request({
      tenantId,
      taskId: task.id,
      stepIndex: 0,
      toolId: 'mail.send',
      args: {},
    });
    await claim();

    const failed = await app.inject({
      method: 'POST',
      url: `/v1/host-steps/${placed.id}/fail`,
      headers: auth,
      payload: {
        host_id: hostId,
        error: {
          code: 'connector.insufficient_scope',
          message: '必要な許可が足りません。接続をやり直して許可してください。',
        },
      },
    });
    expect(failed.statusCode).toBe(204);

    const settled = await bridge.get(tenantId, placed.id);
    expect(settled).toMatchObject({ status: 'FAILED' });
    expect(settled!.result).toBeNull();
    expect(settled!.error!.message).toContain('許可');
  });

  it('refuses a result from a device that did not claim the step', async () => {
    const task = await createTask();
    const placed = await bridge.request({
      tenantId,
      taskId: task.id,
      stepIndex: 0,
      toolId: 'mail.send',
      args: {},
    });
    await claim();

    const other = await heartbeat('third-mac');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/host-steps/${placed.id}/complete`,
      headers: auth,
      payload: { host_id: other, result: { messageId: 'WRONG' } },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((await bridge.get(tenantId, placed.id))!.status).toBe('CLAIMED');
  });

  it('will not carry a credential to the device', async () => {
    const task = await createTask();
    await expect(
      bridge.request({
        tenantId,
        taskId: task.id,
        stepIndex: 0,
        toolId: 'mail.send',
        args: {
          access_token: 'ya29.a0AfH6SMBnotarealtokenbutlongenoughtolooklikeonexxxxxxxxxxxxxxxxxx',
        },
      }),
    ).rejects.toMatchObject({ code: 'common.validation_failed' });
  });

  it('stops rather than falling back when no device is answering', async () => {
    const executor = new HostStepExecutor({ bridge, pollMs: 1, waitMs: 5 });
    // 端末が居ないテナントを使う（heartbeat していない）
    const lonely = uuidv7();

    let thrown: unknown;
    try {
      await executor.execute(
        { taskId: uuidv7(), tenantId: lonely, userId: lonely },
        { index: 0, toolId: 'mail.send', args: {} },
      );
    } catch (error) {
      thrown = error;
    }
    // 失敗ではなく「待てば進む」として投げる。§4.4
    expect(isHostOffline(thrown)).toBe(true);
  });

  it('does not cancel a step it gave up waiting for', async () => {
    const task = await createTask();
    const executor = new HostStepExecutor({ bridge, pollMs: 1, waitMs: 5 });

    let thrown: unknown;
    try {
      await executor.execute(
        { taskId: task.id, tenantId, userId },
        { index: 3, toolId: 'mail.send', args: { to: ['a@example.com'] } },
      );
    } catch (error) {
      thrown = error;
    }
    expect(isHostOffline(thrown)).toBe(true);

    /*
     * 待つのをやめただけで、置いたものは消さない。
     * 消すと、端末が既に送っていた場合に「送っていない」ことになり、
     * 待ち直したときに二度送る。
     */
    const still = await bridge.get(tenantId, (await pendingFor(task.id, 3))!.id);
    expect(still!.status).toBe('PENDING');
  });

  const pendingFor = async (taskId: string, stepIndex: number) =>
    bridge.request({ tenantId, taskId, stepIndex, toolId: 'mail.send', args: {} });
});
