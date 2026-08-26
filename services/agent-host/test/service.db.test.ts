/**
 * 手元の実行基盤。正本 §4.4・§16.1。
 *
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-agent-host test
 *
 * ここで守りたいのは 4 つ:
 *   - 同じ仕事を二重に走らせない
 *   - 仕事を失わない
 *   - 承認を飛ばさない
 *   - 端末が落ちても FAILED にしない
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOST_OFFLINE_AFTER_MS, uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, withSystem, withTenant, type DbHandle } from '@astra/db';
import { AgentHostService } from '../src/service.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('agent host coordination', () => {
  let db: DbHandle;
  let service: AgentHostService;
  let clock = Date.parse('2026-08-27T12:00:00.000Z');

  const tenantId = uuidv7();
  const userId = uuidv7();
  let hostId = '';
  let otherHostId = '';

  const now = (): Date => new Date(clock);

  const makeTask = async (status = 'RUNNING'): Promise<string> => {
    const taskId = uuidv7();
    await withTenant(db, tenantId, (tx) =>
      tx
        .insertInto('tasks')
        .values({
          id: taskId,
          tenant_id: tenantId,
          created_by: userId,
          conversation_id: null,
          kind: 'research',
          title: 'テスト',
          status,
          input: JSON.stringify({}),
          idempotency_key: `k-${taskId}`,
          workflow_id: `wf-${taskId}`,
        })
        .execute(),
    );
    return taskId;
  };

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 8,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-agent-host-test',
    });

    await withIdentity(db, async (tx) => {
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: 'host-test', kind: 'personal' })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await tx
        .insertInto('users')
        .values({
          id: userId,
          email: `host-${userId}@example.com`,
          display_name: 'ホスト試験',
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .onConflict((oc) => oc.doNothing())
        .execute();
    });

    service = new AgentHostService({ db, now, leaseMs: 60_000 });
  }, 120_000);

  beforeEach(async () => {
    clock = Date.parse('2026-08-27T12:00:00.000Z');
    const host = await service.heartbeat({
      tenantId,
      userId,
      deviceLabel: 'macbook',
      models: ['claude_code'],
    });
    hostId = host.id;
    const other = await service.heartbeat({
      tenantId,
      userId,
      deviceLabel: 'other-mac',
      models: ['claude_code'],
    });
    otherHostId = other.id;
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('registering', () => {
    it('does not create a second row for the same device', async () => {
      const again = await service.heartbeat({
        tenantId,
        userId,
        deviceLabel: 'macbook',
        models: ['claude_code', 'anthropic_api'],
      });
      expect(again.id).toBe(hostId);
      expect(again.models).toContain('anthropic_api');
    });

    it('goes offline once the heartbeat stops', async () => {
      clock += HOST_OFFLINE_AFTER_MS + 1_000;
      const hosts = await service.hosts(tenantId, userId);
      expect(hosts.every((h) => h.state === 'offline')).toBe(true);
    });
  });

  describe('leasing a job', () => {
    it('refuses a second host while the first still holds it', async () => {
      const taskId = await makeTask();
      await service.claim({ tenantId, taskId, hostId });

      // **同じ仕事を二重に走らせない。**外部への操作が二度起きる
      await expect(service.claim({ tenantId, taskId, hostId: otherHostId })).rejects.toThrow(
        /already leased/,
      );
    });

    it('lets the same host re-claim after a restart', async () => {
      const taskId = await makeTask();
      const first = await service.claim({ tenantId, taskId, hostId });
      const second = await service.claim({ tenantId, taskId, hostId });

      expect(second.leaseId).not.toBe(first.leaseId);
      // 何回目かが分かる（無限に取り直していないか見るため）
      expect(second.attempt).toBe(2);
    });

    it('lets another host take over once the lease expired', async () => {
      const taskId = await makeTask();
      await service.claim({ tenantId, taskId, hostId });
      clock += 61_000;
      const taken = await service.claim({ tenantId, taskId, hostId: otherHostId });
      expect(taken.hostId).toBe(otherHostId);
    });

    it('rejects a write from a lease that was taken away', async () => {
      const taskId = await makeTask();
      const stale = await service.claim({ tenantId, taskId, hostId });
      clock += 61_000;
      await service.claim({ tenantId, taskId, hostId: otherHostId });

      expect(await service.isLeaseValid(tenantId, taskId, stale.leaseId)).toBe(false);
      await expect(
        service.checkpoint({
          tenantId,
          taskId,
          leaseId: stale.leaseId,
          stepIndex: 3,
          state: {},
        }),
      ).rejects.toThrow(/no longer valid/);
    });

    it('will not renew a lease it no longer holds', async () => {
      const taskId = await makeTask();
      const lease = await service.claim({ tenantId, taskId, hostId });
      await service.release({ tenantId, taskId, leaseId: lease.leaseId });
      await expect(service.renew({ tenantId, taskId, leaseId: lease.leaseId })).rejects.toThrow(
        /no longer valid/,
      );
    });
  });

  describe('checkpoints', () => {
    it('keeps the latest, so a sleep does not restart the work', async () => {
      const taskId = await makeTask();
      const lease = await service.claim({ tenantId, taskId, hostId });

      await service.checkpoint({
        tenantId,
        taskId,
        leaseId: lease.leaseId,
        stepIndex: 1,
        state: { searched: ['a'] },
      });
      await service.checkpoint({
        tenantId,
        taskId,
        leaseId: lease.leaseId,
        stepIndex: 2,
        state: { searched: ['a', 'b'] },
      });

      const saved = await service.lastCheckpoint(tenantId, taskId);
      expect(saved?.stepIndex).toBe(2);
      expect(saved?.state).toEqual({ searched: ['a', 'b'] });
    });

    it('has nothing to say before the work started', async () => {
      const taskId = await makeTask();
      expect(await service.lastCheckpoint(tenantId, taskId)).toBeNull();
    });
  });

  describe('when the device goes away', () => {
    it('pauses instead of failing', async () => {
      const taskId = await makeTask('RUNNING');
      await service.claim({ tenantId, taskId, hostId });

      clock += HOST_OFFLINE_AFTER_MS + 1_000;
      const paused = await service.pauseOrphaned(tenantId);
      expect(paused).toContain(taskId);

      const task = await withTenant(db, tenantId, (tx) =>
        tx.selectFrom('tasks').select('status').where('id', '=', taskId).executeTakeFirstOrThrow(),
      );
      // **FAILED にしない。**失敗にすると、最初からやり直すことになる
      expect(task.status).toBe('PAUSED_HOST_OFFLINE');
    });

    it('leaves a finished job alone', async () => {
      const taskId = await makeTask('COMPLETED');
      await service.claim({ tenantId, taskId, hostId });
      clock += HOST_OFFLINE_AFTER_MS + 1_000;
      expect(await service.pauseOrphaned(tenantId)).not.toContain(taskId);
    });
  });

  describe('coming back', () => {
    it('resumes the paused job', async () => {
      const taskId = await makeTask('PAUSED_HOST_OFFLINE');
      const outcome = await service.resume({
        tenantId,
        taskId,
        hostId,
        wasWaitingApproval: false,
      });
      expect(outcome.resumed).toBe(true);

      const task = await withTenant(db, tenantId, (tx) =>
        tx.selectFrom('tasks').select('status').where('id', '=', taskId).executeTakeFirstOrThrow(),
      );
      expect(task.status).toBe('RUNNING');
    });

    it('does not walk past an approval that was waiting', async () => {
      const taskId = await makeTask('PAUSED_HOST_OFFLINE');
      const outcome = await service.resume({
        tenantId,
        taskId,
        hostId,
        wasWaitingApproval: true,
      });
      // 止まっている間に前提が変わっていることがある
      expect(outcome.resumed).toBe(false);
      expect(outcome.reason).toContain('確認');

      const task = await withTenant(db, tenantId, (tx) =>
        tx.selectFrom('tasks').select('status').where('id', '=', taskId).executeTakeFirstOrThrow(),
      );
      expect(task.status).toBe('PAUSED_HOST_OFFLINE');
    });

    it('does nothing to a job that was never paused', async () => {
      const taskId = await makeTask('RUNNING');
      const outcome = await service.resume({
        tenantId,
        taskId,
        hostId,
        wasWaitingApproval: false,
      });
      expect(outcome.resumed).toBe(false);
    });
  });

  describe('another tenant', () => {
    it('cannot see or take these hosts', async () => {
      const outsider = uuidv7();
      await withSystem(db, async () => undefined);
      expect(await service.hosts(outsider, userId)).toEqual([]);
    });
  });
});
