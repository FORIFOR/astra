/**
 * Task Runtime の縦串。実装仕様 §16 の受け入れテスト AC-2〜AC-11 の土台。
 *
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-task test
 *
 * Temporal は @temporalio/testing のローカルサーバを使う（Docker 不要）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { PROGRESS_HEARTBEAT_MAX_MS, uuidv7, type EventEnvelope } from '@astra/contracts';
import { createDb, withIdentity, withTenant, type DbHandle } from '@astra/db';
import { readAuditChain, verifyAuditChain } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { TaskService } from '../src/service.js';
import { TemporalTaskRuntime } from '../src/runtime/temporal.js';
import { createTaskWorker } from '../src/worker.js';
import { workflowIdFor } from '../src/runtime/types.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const TASK_QUEUE = 'astra.task.test';

describe.skipIf(!url)('task runtime end to end', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let service: TaskService;
  let library: LibraryService;
  let storeRoot: string;

  const tenantId = uuidv7();
  const userId = uuidv7();

  const waitForWorkflow = async (taskId: string): Promise<void> => {
    await env.client.workflow.getHandle(workflowIdFor(tenantId, taskId)).result();
  };

  const events = async (taskId: string): Promise<EventEnvelope[]> =>
    service.eventsAfter(tenantId, taskId, 0);

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-task-test',
    });

    await withIdentity(db, async (tx) => {
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: 'T', kind: 'personal' })
        .execute();
      await tx
        .insertInto('users')
        .values({ id: userId, email: `t-${userId}@example.com`, display_name: 'T' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-objects-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      { db, library, publisher: { async publish() {} } },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: fileURLToPath(new URL('../src/workflows.ts', import.meta.url)),
      },
    );
    workerRun = worker.run();

    service = new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE));
  }, 120_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  }, 60_000);

  describe('create → progress → artifact', () => {
    it('runs a task to completion and leaves an artifact in the library', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'hello astra', steps: 3 } },
        idempotencyKey: `k-${uuidv7()}`,
      });
      expect(task.status).toBe('PENDING');

      await waitForWorkflow(task.id);
      const done = await service.get(tenantId, task.id);
      expect(done.status).toBe('COMPLETED');
      expect(done.result_artifact_id).not.toBeNull();

      const artifact = await library.get(tenantId, done.result_artifact_id!);
      expect(artifact.source_task_id).toBe(task.id);
      expect(artifact.mime_type).toBe('text/markdown');

      const { stream } = await library.readContent(tenantId, artifact.id);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const body = Buffer.concat(chunks);
      expect(body.toString('utf8')).toContain('hello astra');
      // 保存された内容と記録済みハッシュが一致すること（AC-7）
      const { createHash } = await import('node:crypto');
      expect(createHash('sha256').update(body).digest('hex')).toBe(artifact.sha256);
    }, 60_000);

    it('emits a gapless, ordered event stream', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'stream', steps: 2 } },
        idempotencyKey: `k-${uuidv7()}`,
      });
      await waitForWorkflow(task.id);

      const stream = await events(task.id);
      expect(stream.map((e) => e.sequence)).toEqual(stream.map((_, i) => i + 1));

      const types = stream.map((e) => e.type);
      expect(types[0]).toBe('task.started');
      expect(types.at(-1)).toBe('task.completed');
      expect(types.filter((t) => t === 'task.progress')).toHaveLength(2);
      expect(types).toContain('artifact.created');
      expect(types.indexOf('artifact.created')).toBeLessThan(types.indexOf('task.completed'));
    }, 60_000);

    it('keeps progress events closer together than the 2s budget', async () => {
      // 正本 §4.3「2 秒を超える処理は progress event を出す」（AC-6）
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'pace', steps: 4 } },
        idempotencyKey: `k-${uuidv7()}`,
      });
      await waitForWorkflow(task.id);

      const stamps = (await events(task.id)).map((e) => new Date(e.timestamp).getTime());
      for (let i = 1; i < stamps.length; i += 1) {
        expect(stamps[i]! - stamps[i - 1]!).toBeLessThanOrEqual(PROGRESS_HEARTBEAT_MAX_MS);
      }
    }, 60_000);

    it('replays only what comes after the given sequence', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'replay', steps: 2 } },
        idempotencyKey: `k-${uuidv7()}`,
      });
      await waitForWorkflow(task.id);

      const all = await events(task.id);
      const tail = await service.eventsAfter(tenantId, task.id, 3);
      expect(tail.map((e) => e.sequence)).toEqual(all.slice(3).map((e) => e.sequence));
      expect(tail.every((e) => e.sequence > 3)).toBe(true);
    }, 60_000);
  });

  describe('idempotency', () => {
    it('returns the same task and starts only one workflow', async () => {
      const key = `k-${uuidv7()}`;
      const first = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'once' } },
        idempotencyKey: key,
      });
      const second = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'once' } },
        idempotencyKey: key,
      });

      expect(second.task.id).toBe(first.task.id);
      expect(second.deduplicated).toBe(true);
      await waitForWorkflow(first.task.id);

      const stream = await events(first.task.id);
      expect(stream.filter((e) => e.type === 'task.started')).toHaveLength(1);
    }, 60_000);

    it('rejects a kind nothing can run', async () => {
      await expect(
        service.create({
          tenantId,
          userId,
          request: { kind: 'does-not-exist', input: {} },
          idempotencyKey: `k-${uuidv7()}`,
        }),
      ).rejects.toThrow(/unknown task kind/);
    });
  });

  describe('approval', () => {
    it('waits, then completes when approved', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'approve me', require_approval: true } },
        idempotencyKey: `k-${uuidv7()}`,
      });

      const approval = await waitForApproval(db, tenantId, task.id);
      const waiting = await service.get(tenantId, task.id);
      expect(waiting.status).toBe('WAITING_APPROVAL');

      await service.decideApproval(tenantId, task.id, userId, approval, 'APPROVED');
      await waitForWorkflow(task.id);

      const done = await service.get(tenantId, task.id);
      expect(done.status).toBe('COMPLETED');

      // 正本 §9.4: 承認を要した write action は receipt を残す
      const receipts = await withTenant(db, tenantId, (tx) =>
        tx.selectFrom('action_receipts').selectAll().where('task_id', '=', task.id).execute(),
      );
      expect(receipts.length).toBeGreaterThan(0);
      expect(receipts.some((r) => r.risk === 'EXTERNAL_COMMIT')).toBe(true);
    }, 60_000);

    it('cancels the task when rejected and performs no external write', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'reject me', require_approval: true } },
        idempotencyKey: `k-${uuidv7()}`,
      });

      const approval = await waitForApproval(db, tenantId, task.id);
      await service.decideApproval(tenantId, task.id, userId, approval, 'REJECTED');
      await waitForWorkflow(task.id);

      const done = await service.get(tenantId, task.id);
      expect(done.status).toBe('CANCELLED');
      expect(done.result_artifact_id).toBeNull();

      const receipts = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('action_receipts')
          .selectAll()
          .where('task_id', '=', task.id)
          .where('risk', '=', 'EXTERNAL_COMMIT')
          .execute(),
      );
      expect(receipts).toEqual([]);
    }, 60_000);

    it('refuses to decide the same approval twice', async () => {
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: { message: 'twice', require_approval: true } },
        idempotencyKey: `k-${uuidv7()}`,
      });
      const approval = await waitForApproval(db, tenantId, task.id);
      await service.decideApproval(tenantId, task.id, userId, approval, 'APPROVED');
      await waitForWorkflow(task.id);

      // 文面ではなく契約上のコードで検証する（§3.7）
      await expect(
        service.decideApproval(tenantId, task.id, userId, approval, 'APPROVED'),
      ).rejects.toMatchObject({ code: 'approval.already_decided' });
    }, 60_000);
  });

  describe('isolation and audit', () => {
    it('hides a task from another tenant', async () => {
      const other = uuidv7();
      await withIdentity(db, (tx) =>
        tx.insertInto('tenants').values({ id: other, name: 'O', kind: 'personal' }).execute(),
      );
      const { task } = await service.create({
        tenantId,
        userId,
        request: { kind: 'echo', input: {} },
        idempotencyKey: `k-${uuidv7()}`,
      });
      await waitForWorkflow(task.id);
      await expect(service.get(other, task.id)).rejects.toThrow(/no task/);
    }, 60_000);

    it('keeps the audit chain intact through all of this', async () => {
      const chain = await withTenant(db, tenantId, (tx) => readAuditChain(tx, tenantId));
      expect(chain.length).toBeGreaterThan(0);
      expect(chain.map((r) => r.action)).toContain('task.created');
      expect(chain.map((r) => r.action)).toContain('artifact.created');
      expect(await verifyAuditChain(chain)).toEqual([]);
    });
  });
});

async function waitForApproval(db: DbHandle, tenantId: string, taskId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('approvals')
        .select(['id'])
        .where('task_id', '=', taskId)
        .where('status', '=', 'PENDING')
        .executeTakeFirst(),
    );
    if (row) return row.id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no approval appeared for task ${taskId}`);
}
