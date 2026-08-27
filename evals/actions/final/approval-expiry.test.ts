/**
 * 承認待ちは、いつか切れる。実装仕様 §6.5、正本 §9。
 *
 * **時間を飛ばして確かめる。**24 時間を実際に待てないので、
 * 待たない試験しか書かれず、期限切れの経路は一度も通っていなかった。
 * その間、`condition` の待ち時間が効いておらず、
 * **承認待ちは永久に切れなかった**（期限切れの処理は書いてあるのに、
 * そこへ辿り着けなかった）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, withTenant, type DbHandle } from '@astra/db';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { createTaskWorker, type TaskResult } from '@astra/service-task';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const TASK_QUEUE = 'astra.task.expiry';

describe.skipIf(!url)('an approval nobody answers', () => {
  let db: DbHandle;
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let storeRoot = '';

  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 8,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-expiry',
    });
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-expiry-'));

    await withIdentity(db, async (tx) => {
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: 'expiry', kind: 'personal' })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await tx
        .insertInto('users')
        .values({ id: userId, email: `expiry-${userId}@example.com`, display_name: '期限試験' })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .onConflict((oc) => oc.doNothing())
        .execute();
    });

    // **時間を飛ばす環境。**24 時間を実際に待たずに、その先を見る。
    env = await TestWorkflowEnvironment.createTimeSkipping();
    worker = await createTaskWorker(
      {
        db,
        library: new LibraryService(db, new FsObjectStore(storeRoot)),
        publisher: { async publish() {} },
      },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: path.join(repoRoot, 'services/task/src/workflows.ts'),
      },
    );
    workerRun = worker.run();
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('expires instead of waiting forever', async () => {
    const taskId = uuidv7();
    await withTenant(db, tenantId, (tx) =>
      tx
        .insertInto('tasks')
        .values({
          id: taskId,
          tenant_id: tenantId,
          created_by: userId,
          conversation_id: null,
          kind: 'echo',
          title: '期限試験',
          status: 'PENDING',
          input: JSON.stringify({ message: 'x', require_approval: true }),
          idempotency_key: `expiry-${taskId}`,
          workflow_id: `wf-${taskId}`,
        })
        .execute(),
    );

    // 型を持ち込まずに名前で起こす。workflow の実体は bundle 側にある。
    const result = (await env.client.workflow.execute('TaskWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-${taskId}`,
      args: [
        {
          taskId,
          tenantId,
          userId,
          kind: 'echo',
          input: { message: 'x', require_approval: true },
        },
      ],
    })) as TaskResult;

    // 誰も答えないまま 24 時間。**永久に待たない。**
    expect(result.status).toBe('FAILED');

    const row = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('tasks')
        .select(['status', 'error'])
        .where('id', '=', taskId)
        .executeTakeFirst(),
    );
    expect(row!.status).toBe('FAILED');
    expect(JSON.stringify(row!.error)).toContain('task.approval_timeout');

    // 承認そのものも、返事待ちのまま残さない
    const approval = await withTenant(db, tenantId, (tx) =>
      tx
        .selectFrom('approvals')
        .select(['status'])
        .where('task_id', '=', taskId)
        .executeTakeFirst(),
    );
    expect(approval!.status).toBe('EXPIRED');
  }, 300_000);
});
