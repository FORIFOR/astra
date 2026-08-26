/**
 * TaskWorkflow。正本 §16.3、実装仕様 §6.3。
 *
 * このファイルは Temporal のサンドボックスで動く。**決定的**でなければならないので、
 * 乱数・時刻・I/O・Node の API を直接触らない。すべて activity 経由。
 */
import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import { planTask, type TaskPlan } from './plan.js';
import type { TaskActivities } from './activity-types.js';

const persistence = proxyActivities<TaskActivities>({
  startToCloseTimeout: '30 seconds',
  // DB は粘る。ただし親が消えているなら粘っても無駄なので止める。
  retry: { maximumAttempts: 10, nonRetryableErrorTypes: ['TaskGone'] },
});

const tools = proxyActivities<TaskActivities>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
    // 何度やっても同じ結果になるものは再試行しない（実装仕様 §6.5）
    nonRetryableErrorTypes: [
      'ValidationError',
      'PermissionDenied',
      'ApprovalRejected',
      'UnknownTaskKind',
      'TenantMismatch',
      // タスクやテナントが消えたあとに再試行し続けない
      'TaskGone',
    ],
  },
});

export interface TaskWorkflowInput {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly kind: string;
  readonly input: Record<string, unknown>;
  /**
   * 作成時に確定した計画（D-40）。
   *
   * **workflow に計画を作らせない。**install した plugin の agent は
   * 固定リストに入らないので DB を読む必要があるが、workflow のコードは
   * 決定的でなければならない。だから作る側で確定させて持ち込む。
   */
  readonly plan?: TaskPlan;
}

export interface TaskResult {
  readonly artifactId: string | null;
  readonly status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

export interface ApprovalDecisionSignal {
  readonly approvalId: string;
  readonly decision: 'APPROVED' | 'REJECTED';
}

export const approveSignal = defineSignal<[ApprovalDecisionSignal]>('approve');
export const cancelSignal = defineSignal<[{ reason: string }]>('cancel');

export interface TaskStateSnapshot {
  readonly status: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly awaitingApprovalId: string | null;
}

export const getStateQuery = defineQuery<TaskStateSnapshot>('getState');

/** 承認待ちの上限。`approvals.expires_at` と揃える（実装仕様 §6.5）。 */
const APPROVAL_TIMEOUT = '24 hours';

export async function TaskWorkflow(input: TaskWorkflowInput): Promise<TaskResult> {
  const decisions = new Map<string, 'APPROVED' | 'REJECTED'>();
  let cancelRequested: string | null = null;
  let stepIndex = 0;
  let awaitingApprovalId: string | null = null;
  let status = 'RUNNING';

  setHandler(approveSignal, (signal) => {
    decisions.set(signal.approvalId, signal.decision);
  });
  setHandler(cancelSignal, (signal) => {
    cancelRequested = signal.reason;
  });

  let plan: TaskPlan;
  try {
    // 持ち込まれた計画を優先する。無ければ組み込みの種別として計画する。
    plan = input.plan ?? planTask(input.kind, input.input);
  } catch {
    // 未知の種別は再試行しても変わらない。即座に失敗させる。
    await persistence.failTask(input, {
      code: 'task.unknown_kind',
      message: `unknown task kind: ${input.kind}`,
      step_index: null,
      retryable: false,
    });
    throw ApplicationFailure.nonRetryable(`unknown task kind: ${input.kind}`, 'UnknownTaskKind');
  }

  setHandler(getStateQuery, () => ({
    status,
    stepIndex,
    stepCount: plan.steps.length,
    awaitingApprovalId,
  }));

  await persistence.startTask(input, {
    kind: input.kind,
    title: plan.artifact.title,
    step_count: plan.steps.length,
    run_id: workflowInfo().runId,
  });

  const results: unknown[] = [];

  for (const step of plan.steps) {
    stepIndex = step.index;

    if (cancelRequested !== null) {
      return finishCancelled(input, cancelRequested);
    }

    const approval = await persistence.requestApprovalIfNeeded(input, step);
    if (approval) {
      awaitingApprovalId = approval.approvalId;
      status = 'WAITING_APPROVAL';

      const decided = await condition(
        () => decisions.has(approval.approvalId) || cancelRequested !== null,
        APPROVAL_TIMEOUT,
      );

      if (cancelRequested !== null) return finishCancelled(input, cancelRequested);

      if (!decided) {
        await persistence.expireApproval(input, approval.approvalId);
        await persistence.failTask(input, {
          code: 'task.approval_timeout',
          message: 'approval was not granted in time',
          step_index: step.index,
          retryable: false,
        });
        status = 'FAILED';
        return { artifactId: null, status: 'FAILED' };
      }

      if (decisions.get(approval.approvalId) === 'REJECTED') {
        await persistence.rejectApproval(input, approval.approvalId, step.index);
        status = 'CANCELLED';
        return { artifactId: null, status: 'CANCELLED' };
      }

      await persistence.acceptApproval(input, approval.approvalId);
      awaitingApprovalId = null;
      status = 'RUNNING';
    }

    results.push(await tools.executeStep(input, step));
  }

  if (cancelRequested !== null) return finishCancelled(input, cancelRequested);

  const artifactId = await tools.composeArtifact(input, plan.artifact, results);
  await persistence.completeTask(input, artifactId);
  status = 'COMPLETED';
  return { artifactId, status: 'COMPLETED' };

  async function finishCancelled(wf: TaskWorkflowInput, reason: string): Promise<TaskResult> {
    // 実行中の外部書き込みは中断しない。中途半端な副作用を作らない（正本 §24）
    await persistence.cancelTask(wf, reason);
    status = 'CANCELLED';
    return { artifactId: null, status: 'CANCELLED' };
  }
}
