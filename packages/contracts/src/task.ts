/**
 * Task。正本 §4.2 / §19 / §24、実装仕様 §3.3 / §6。
 */
import { z } from 'zod';
import { ArtifactId, ConversationId, TaskId, TenantId, UserId } from './ids.js';
import { JsonObject, Timestamp } from './primitives.js';
import { ErrorCode } from './errors.js';

export const TASK_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'CANCELLING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TERMINAL_TASK_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly TaskStatus[];

export const isTerminal = (s: TaskStatus): boolean =>
  (TERMINAL_TASK_STATUSES as readonly string[]).includes(s);

/**
 * 許可された状態遷移。`updateTaskStatus` activity はこの表以外の遷移を拒否する
 * （実装仕様 §6.4）。同一状態への遷移は no-op として許す（activity の再実行対策）。
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  PENDING: ['RUNNING', 'CANCELLING', 'FAILED', 'CANCELLED'],
  RUNNING: ['WAITING_APPROVAL', 'CANCELLING', 'COMPLETED', 'FAILED'],
  WAITING_APPROVAL: ['RUNNING', 'CANCELLING', 'FAILED', 'CANCELLED'],
  CANCELLING: ['CANCELLED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from].includes(to);
}

export const TaskError = z.object({
  code: ErrorCode,
  message: z.string(),
  /** どの step で落ちたか。正本 §24「勝手に成功扱いしない」の説明責任のため。 */
  step_index: z.number().int().nonnegative().nullable(),
  retryable: z.boolean(),
});
export type TaskError = z.infer<typeof TaskError>;

export const Task = z.object({
  id: TaskId,
  tenant_id: TenantId,
  created_by: UserId,
  conversation_id: ConversationId.nullable(),
  kind: z.string().min(1).max(64),
  title: z.string().max(200).nullable(),
  status: TaskStatus,
  input: JsonObject,
  result_artifact_id: ArtifactId.nullable(),
  error: TaskError.nullable(),
  created_at: Timestamp,
  started_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  updated_at: Timestamp,
});
export type Task = z.infer<typeof Task>;

export const CreateTaskRequest = z.object({
  kind: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  input: JsonObject.default({}),
  conversation_id: ConversationId.optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const CancelTaskRequest = z.object({
  reason: z.string().max(500).default('user_requested'),
});
export type CancelTaskRequest = z.infer<typeof CancelTaskRequest>;

/**
 * Task Dock の UI ステート（正本 §4.2）。
 * サーバの TaskStatus と 1:1 にしない。HIDDEN/READY/LISTENING/UNDERSTANDING/MINIMIZED は
 * クライアント固有で、サーバ状態を持たない（実装仕様 §3.3 の対応表）。
 */
export const TaskDockState = z.enum([
  'HIDDEN',
  'READY',
  'LISTENING',
  'UNDERSTANDING',
  'THINKING',
  'RESEARCHING',
  'ACTING',
  'WAITING_APPROVAL',
  'RESULT',
  'ERROR',
  'MINIMIZED',
]);
export type TaskDockState = z.infer<typeof TaskDockState>;

/** サーバ状態から Task Dock の既定表示状態を導く。phase 未指定なら THINKING。 */
export function dockStateFor(
  status: TaskStatus,
  phase?: 'thinking' | 'researching' | 'acting',
): TaskDockState {
  switch (status) {
    case 'PENDING':
    case 'RUNNING':
    case 'CANCELLING':
      if (phase === 'researching') return 'RESEARCHING';
      if (phase === 'acting') return 'ACTING';
      return 'THINKING';
    case 'WAITING_APPROVAL':
      return 'WAITING_APPROVAL';
    case 'COMPLETED':
      return 'RESULT';
    case 'FAILED':
      return 'ERROR';
    case 'CANCELLED':
      return 'READY';
  }
}

/** 正本 §4.3「2秒を超える処理は progress event を出す」。受け入れテスト AC-6 の閾値。 */
export const PROGRESS_HEARTBEAT_MAX_MS = 2000;
