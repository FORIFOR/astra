/**
 * activity の実装。実装仕様 §6.4。
 *
 * すべて冪等。Temporal は activity を再実行し得るので、
 * 「2 回走っても結果が変わらない」ことを DB の制約で担保する。
 */
import { canonicalSha256, uuidv7, type ActionRisk } from '@astra/contracts';
import { withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import { approvalTtlMs, evaluate } from '@astra/policy';
import type { LibraryService } from '@astra/service-library';
import { appendEvent, type EventPublisher } from './events.js';
import { approvalSummaryFor, type TaskStep } from './plan.js';
import type {
  ArtifactSpec,
  RequestedApproval,
  StartTaskMeta,
  TaskActivities,
  TaskErrorPayload,
} from './activity-types.js';
import type { TaskWorkflowInput } from './workflows.js';

export interface ActivityDeps {
  readonly db: DbHandle;
  readonly library: LibraryService;
  readonly publisher: EventPublisher;
  /** 監査に載せるアプリ版など、将来の付帯情報 */
  readonly now?: () => Date;
}

const stepKey = (taskId: string, index: number, name: string): string =>
  `${taskId}:${index}:${name}`;

export function createTaskActivities(deps: ActivityDeps): TaskActivities {
  const now = deps.now ?? (() => new Date());

  const inTenant = <T>(input: TaskWorkflowInput, fn: (tx: ScopedDb) => Promise<T>): Promise<T> =>
    withTenant(deps.db, input.tenantId, fn);

  return {
    async startTask(input, meta: StartTaskMeta) {
      await inTenant(input, async (tx) => {
        await tx
          .updateTable('tasks')
          .set({
            status: 'RUNNING',
            title: meta.title,
            run_id: meta.run_id,
            started_at: now(),
            updated_at: now(),
          })
          .where('id', '=', input.taskId)
          // 終端に達したタスクを掘り起こさない（状態遷移表。実装仕様 §3.3）
          .where('status', 'in', ['PENDING', 'RUNNING'])
          .execute();

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.started',
            payload: { kind: meta.kind, title: meta.title, step_count: meta.step_count },
            idempotencyKey: stepKey(input.taskId, -1, 'started'),
          },
          deps.publisher,
        );
      });
    },

    async requestApprovalIfNeeded(input, step: TaskStep): Promise<RequestedApproval | null> {
      const decision = evaluate({
        risk: step.risk as ActionRisk,
        complianceProfile: 'GENERAL',
        surface: step.surface,
      });
      if (!decision.requiresApproval) return null;

      return inTenant(input, async (tx) => {
        const existing = await tx
          .selectFrom('approvals')
          .select(['id'])
          .where('task_id', '=', input.taskId)
          .where('step_index', '=', step.index)
          .executeTakeFirst();
        if (existing) return { approvalId: existing.id };

        const approvalId = uuidv7();
        const expiresAt = new Date(now().getTime() + approvalTtlMs(step.risk as ActionRisk));
        const card = approvalSummaryFor(step);

        await tx
          .insertInto('approvals')
          .values({
            id: approvalId,
            tenant_id: input.tenantId,
            task_id: input.taskId,
            step_index: step.index,
            risk: step.risk,
            summary: card.summary,
            details: JSON.stringify({ items: card.details, impact: card.impact }),
            editable_fields: JSON.stringify([]),
            status: 'PENDING',
            expires_at: expiresAt,
            created_at: now(),
          })
          .execute();

        await tx
          .updateTable('tasks')
          .set({ status: 'WAITING_APPROVAL', updated_at: now() })
          .where('id', '=', input.taskId)
          .where('status', '=', 'RUNNING')
          .execute();

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.waiting_approval',
            payload: {
              approval_id: approvalId,
              risk: step.risk,
              summary: card.summary,
              primary_action_label: card.impact.primary_action_label,
              expires_at: expiresAt.toISOString(),
            },
            idempotencyKey: stepKey(input.taskId, step.index, 'approval'),
          },
          deps.publisher,
        );

        await appendAuditEvent(tx, input.tenantId, {
          actorType: 'agent',
          action: 'approval.requested',
          taskId: input.taskId,
          payload: { approval_id: approvalId, risk: step.risk },
        });

        return { approvalId };
      });
    },

    async acceptApproval(input, approvalId) {
      await inTenant(input, async (tx) => {
        await tx
          .updateTable('tasks')
          .set({ status: 'RUNNING', updated_at: now() })
          .where('id', '=', input.taskId)
          .where('status', '=', 'WAITING_APPROVAL')
          .execute();
        await appendAuditEvent(tx, input.tenantId, {
          actorType: 'user',
          action: 'approval.decided',
          taskId: input.taskId,
          payload: { approval_id: approvalId, decision: 'APPROVED' },
        });
      });
    },

    async rejectApproval(input, approvalId, stepIndex) {
      await inTenant(input, async (tx) => {
        await tx
          .updateTable('tasks')
          .set({ status: 'CANCELLED', completed_at: now(), updated_at: now() })
          .where('id', '=', input.taskId)
          .execute();
        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.cancelled',
            payload: { reason: 'approval_rejected' },
            idempotencyKey: stepKey(input.taskId, stepIndex, 'rejected'),
          },
          deps.publisher,
        );
        await appendAuditEvent(tx, input.tenantId, {
          actorType: 'user',
          action: 'approval.decided',
          taskId: input.taskId,
          payload: { approval_id: approvalId, decision: 'REJECTED' },
        });
      });
    },

    async expireApproval(input, approvalId) {
      await inTenant(input, async (tx) => {
        await tx
          .updateTable('approvals')
          .set({ status: 'EXPIRED' })
          .where('id', '=', approvalId)
          .where('status', '=', 'PENDING')
          .execute();
        await appendAuditEvent(tx, input.tenantId, {
          actorType: 'system',
          action: 'approval.expired',
          taskId: input.taskId,
          payload: { approval_id: approvalId },
        });
      });
    },

    async executeStep(input, step: TaskStep) {
      const decision = evaluate({
        risk: step.risk as ActionRisk,
        complianceProfile: 'GENERAL',
        surface: step.surface,
      });
      const startedAt = Date.now();

      await inTenant(input, (tx) =>
        appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'tool.started',
            payload: {
              step_index: step.index,
              tool_id: step.toolId,
              risk: step.risk,
              surface: step.surface,
            },
            idempotencyKey: stepKey(input.taskId, step.index, 'tool.started'),
          },
          deps.publisher,
        ),
      );

      // Phase 0 の唯一の tool。実際の副作用は無い（実装仕様 §6.6）
      const result = { echoed: step.args['message'] ?? null, step: step.index };

      const receiptId = decision.requiresReceipt ? uuidv7() : null;

      await inTenant(input, async (tx) => {
        if (receiptId) {
          // 正本 §9.4: 全 write action は receipt を残す。
          // 承認を要した step は「誰が承認したか」まで残さないと、
          // 後から「その操作は誰の判断だったか」を答えられない。
          const approver = decision.requiresApproval
            ? ((
                await tx
                  .selectFrom('approvals')
                  .select(['decided_by'])
                  .where('task_id', '=', input.taskId)
                  .where('step_index', '=', step.index)
                  .where('status', '=', 'APPROVED')
                  .executeTakeFirst()
              )?.decided_by ?? null)
            : null;

          const inputsHash = await canonicalSha256(step.args);
          await tx
            .insertInto('action_receipts')
            .values({
              id: receiptId,
              tenant_id: input.tenantId,
              task_id: input.taskId,
              tool_id: step.toolId,
              actor: 'agent',
              inputs_hash: inputsHash,
              result_ref: null,
              risk: step.risk,
              approved_by: approver,
              reversible_until: null,
              executed_at: now(),
            })
            .onConflict((oc) => oc.columns(['task_id', 'tool_id', 'inputs_hash']).doNothing())
            .execute();
        }

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'tool.completed',
            payload: {
              step_index: step.index,
              tool_id: step.toolId,
              ok: true,
              receipt_id: receiptId,
              duration_ms: Date.now() - startedAt,
            },
            idempotencyKey: stepKey(input.taskId, step.index, 'tool.completed'),
          },
          deps.publisher,
        );

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.progress',
            payload: {
              phase: 'thinking',
              step_index: step.index,
              step_count: null,
              message: step.message,
              detail: null,
              elapsed_ms: Date.now() - startedAt,
              retrying: false,
            },
            idempotencyKey: stepKey(input.taskId, step.index, 'progress'),
          },
          deps.publisher,
        );
      });

      return result;
    },

    async composeArtifact(input, spec: ArtifactSpec, results) {
      // 同一タスクで既に成果物があれば作り直さない（activity 再実行対策）。
      // artifacts は library の所有テーブルなので、直接引かず service に尋ねる（§5.1）。
      const existing = await deps.library.findBySourceTask(input.tenantId, input.taskId);
      if (existing) return existing.id;

      const lines = [
        `# ${spec.title}`,
        '',
        ...results.map((r, i) => `- step ${i + 1}: ${JSON.stringify(r)}`),
      ];
      const artifact = await deps.library.create({
        tenantId: input.tenantId,
        ownerId: input.userId,
        type: spec.type,
        title: spec.title,
        mimeType: spec.mimeType,
        body: Buffer.from(lines.join('\n'), 'utf8'),
        fileName: `${spec.title}.md`,
        sourceTaskId: input.taskId,
        sourceAgentId: 'general',
      });

      await inTenant(input, (tx) =>
        appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'artifact.created',
            payload: {
              artifact_id: artifact.id,
              type: artifact.type,
              title: artifact.title,
              size: artifact.size,
            },
            idempotencyKey: stepKey(input.taskId, -2, 'artifact'),
          },
          deps.publisher,
        ),
      );

      return artifact.id;
    },

    async completeTask(input, artifactId) {
      await inTenant(input, async (tx) => {
        const startedAt = await tx
          .selectFrom('tasks')
          .select(['created_at'])
          .where('id', '=', input.taskId)
          .executeTakeFirst();

        await tx
          .updateTable('tasks')
          .set({
            status: 'COMPLETED',
            result_artifact_id: artifactId,
            completed_at: now(),
            updated_at: now(),
          })
          .where('id', '=', input.taskId)
          .where('status', 'in', ['RUNNING', 'PENDING'])
          .execute();

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.completed',
            payload: {
              result_artifact_id: artifactId,
              duration_ms: startedAt
                ? Math.max(0, now().getTime() - startedAt.created_at.getTime())
                : 0,
            },
            idempotencyKey: stepKey(input.taskId, -3, 'completed'),
          },
          deps.publisher,
        );
      });
    },

    async failTask(input, error: TaskErrorPayload) {
      await inTenant(input, async (tx) => {
        await tx
          .updateTable('tasks')
          .set({
            status: 'FAILED',
            error: JSON.stringify(error),
            completed_at: now(),
            updated_at: now(),
          })
          .where('id', '=', input.taskId)
          .where('status', 'not in', ['COMPLETED', 'CANCELLED'])
          .execute();

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.failed',
            payload: { error },
            idempotencyKey: stepKey(input.taskId, error.step_index ?? -4, 'failed'),
          },
          deps.publisher,
        );
      });
    },

    async cancelTask(input, reason) {
      await inTenant(input, async (tx) => {
        await tx
          .updateTable('tasks')
          .set({ status: 'CANCELLED', completed_at: now(), updated_at: now() })
          .where('id', '=', input.taskId)
          .where('status', 'not in', ['COMPLETED', 'FAILED'])
          .execute();

        await appendEvent(
          tx,
          {
            tenantId: input.tenantId,
            streamKind: 'task',
            streamId: input.taskId,
            taskId: input.taskId,
            type: 'task.cancelled',
            payload: { reason },
            idempotencyKey: stepKey(input.taskId, -5, 'cancelled'),
          },
          deps.publisher,
        );

        await appendAuditEvent(tx, input.tenantId, {
          actorType: 'user',
          action: 'task.cancelled',
          taskId: input.taskId,
          payload: { reason },
        });
      });
    },
  };
}
