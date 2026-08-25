/**
 * Task サービス。実装仕様 §11・§6。
 *
 * HTTP を知らない。Fastify 型はここへ持ち込まない（ADR 0004）。
 */
import {
  AstraError,
  Task,
  isTerminal,
  uuidv7,
  type CreateTaskRequest,
  type TaskStatus,
} from '@astra/contracts';
import { withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import { ensureStream, readEventsAfter } from './events.js';
import { isKnownTaskKind } from './plan.js';
import { workflowIdFor, type TaskRuntime } from './runtime/index.js';

export interface CreateTaskParams {
  readonly tenantId: string;
  readonly userId: string;
  readonly request: CreateTaskRequest;
  readonly idempotencyKey: string;
}

export interface CreateTaskResult {
  readonly task: Task;
  /** 既存の冪等キーに当たったか。true なら新しい実行は起きていない。 */
  readonly deduplicated: boolean;
}

export class TaskService {
  readonly #db: DbHandle;
  readonly #runtime: TaskRuntime;

  constructor(db: DbHandle, runtime: TaskRuntime) {
    this.#db = db;
    this.#runtime = runtime;
  }

  /**
   * タスクを受理する。
   *
   * 二重防御（実装仕様 §6.2）:
   *   1. `tasks_idempotency` の一意制約で API 層が弾く
   *   2. Temporal の workflow id 一意性で実行層が弾く
   *
   * DB のコミット後にワークフローを起動する。逆順にすると、行が見える前に
   * activity が走って「知らないタスク」を更新しに行く。
   */
  async create(params: CreateTaskParams): Promise<CreateTaskResult> {
    if (!isKnownTaskKind(params.request.kind)) {
      throw new AstraError('task.unknown_kind', `unknown task kind: ${params.request.kind}`);
    }

    const taskId = uuidv7();
    const workflowId = workflowIdFor(params.tenantId, taskId);

    const stored = await withTenant(this.#db, params.tenantId, async (tx) => {
      const inserted = await tx
        .insertInto('tasks')
        .values({
          id: taskId,
          tenant_id: params.tenantId,
          created_by: params.userId,
          conversation_id: params.request.conversation_id ?? null,
          kind: params.request.kind,
          title: params.request.title ?? null,
          status: 'PENDING',
          input: JSON.stringify(params.request.input),
          idempotency_key: params.idempotencyKey,
          workflow_id: workflowId,
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'created_by', 'idempotency_key']).doNothing())
        .returning(['id'])
        .executeTakeFirst();

      if (!inserted) {
        // 同じ冪等キーの再送。既存のタスクをそのまま返す。
        const existing = await tx
          .selectFrom('tasks')
          .selectAll()
          .where('created_by', '=', params.userId)
          .where('idempotency_key', '=', params.idempotencyKey)
          .executeTakeFirstOrThrow();
        return { row: existing, created: false };
      }

      await ensureStream(tx, params.tenantId, 'task', taskId);
      await appendAuditEvent(tx, params.tenantId, {
        actorType: 'user',
        actorId: params.userId,
        action: 'task.created',
        taskId,
        payload: { kind: params.request.kind },
      });

      const row = await tx
        .selectFrom('tasks')
        .selectAll()
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow();
      return { row, created: true };
    });

    // 起動はコミット後。冪等キーの再送でも、まだ起動していなければ起動を試みる
    // （Temporal 側が二重起動を弾くので、ここで再試行しても安全）。
    if (stored.row.status === 'PENDING') {
      await this.#runtime.start(
        {
          taskId: stored.row.id,
          tenantId: params.tenantId,
          userId: params.userId,
          kind: stored.row.kind,
          input: (stored.row.input ?? {}) as Record<string, unknown>,
        },
        stored.row.workflow_id,
      );
    }

    return { task: toTask(stored.row), deduplicated: !stored.created };
  }

  async get(tenantId: string, taskId: string): Promise<Task> {
    return withTenant(this.#db, tenantId, async (tx) => toTask(await loadTask(tx, taskId)));
  }

  async list(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: Task[]; nextCursor: string | null }> {
    return withTenant(this.#db, tenantId, async (tx) => {
      let statement = tx
        .selectFrom('tasks')
        .selectAll()
        .orderBy('id', 'desc')
        .limit(limit + 1);
      if (cursor) statement = statement.where('id', '<', cursor);

      const rows = await statement.execute();
      const page = rows.slice(0, limit);
      return {
        items: page.map(toTask),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** 取消要求。実際の終了はワークフローが決めるので、ここでは CANCELLING までしか進めない。 */
  async cancel(tenantId: string, taskId: string, reason: string): Promise<Task> {
    const row = await withTenant(this.#db, tenantId, async (tx) => {
      const task = await loadTask(tx, taskId);
      if (isTerminal(task.status as TaskStatus)) {
        throw new AstraError('task.invalid_state', `task is already ${task.status}`);
      }
      await tx
        .updateTable('tasks')
        .set({ status: 'CANCELLING', updated_at: new Date() })
        .where('id', '=', taskId)
        .execute();
      return task;
    });

    await this.#runtime.cancel(row.workflow_id, reason);
    return this.get(tenantId, taskId);
  }

  /** 承認の決定を反映する。実装仕様 §3.4。 */
  async decideApproval(
    tenantId: string,
    taskId: string,
    userId: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    const workflowId = await withTenant(this.#db, tenantId, async (tx) => {
      const task = await loadTask(tx, taskId);
      const approval = await tx
        .selectFrom('approvals')
        .select(['id', 'status', 'expires_at'])
        .where('id', '=', approvalId)
        .where('task_id', '=', taskId)
        .executeTakeFirst();

      if (!approval) throw new AstraError('approval.not_found', 'no such approval');
      if (approval.status !== 'PENDING') {
        throw new AstraError('approval.already_decided', `approval is ${approval.status}`);
      }
      if (approval.expires_at.getTime() <= Date.now()) {
        await tx
          .updateTable('approvals')
          .set({ status: 'EXPIRED' })
          .where('id', '=', approvalId)
          .execute();
        throw new AstraError('approval.expired', 'approval expired');
      }

      await tx
        .updateTable('approvals')
        .set({ status: decision, decided_by: userId, decided_at: new Date() })
        .where('id', '=', approvalId)
        .execute();

      return task.workflow_id;
    });

    await this.#runtime.approve(workflowId, approvalId, decision);
  }

  /** SSE のリプレイ用（実装仕様 §7.3）。 */
  async eventsAfter(tenantId: string, taskId: string, after: number) {
    return withTenant(this.#db, tenantId, async (tx) => {
      await loadTask(tx, taskId);
      return readEventsAfter(tx, 'task', taskId, after);
    });
  }
}

type TaskRow = {
  id: string;
  tenant_id: string;
  created_by: string;
  conversation_id: string | null;
  kind: string;
  title: string | null;
  status: string;
  input: unknown;
  result_artifact_id: string | null;
  error: unknown;
  workflow_id: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

async function loadTask(tx: ScopedDb, taskId: string): Promise<TaskRow> {
  const row = await tx.selectFrom('tasks').selectAll().where('id', '=', taskId).executeTakeFirst();
  // RLS で他テナントの行は見えない。ここに来る「無い」は 404 で正しい（逸脱 D-11）
  if (!row) throw new AstraError('task.not_found', `no task ${taskId}`);
  return row as TaskRow;
}

function toTask(row: TaskRow): Task {
  return Task.parse({
    id: row.id,
    tenant_id: row.tenant_id,
    created_by: row.created_by,
    conversation_id: row.conversation_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    input: row.input ?? {},
    result_artifact_id: row.result_artifact_id,
    error: row.error ?? null,
    created_at: row.created_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  });
}
