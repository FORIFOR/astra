/**
 * タスク実行基盤の抽象。実装仕様 §6.2。
 *
 * サービス層が Temporal の API に直接触らないようにする。
 * テストは軽量な代替実装を差し込み、ワークフロー本体の検証は
 * Temporal の test environment で別途行う。
 */
import type { TaskStateSnapshot, TaskWorkflowInput } from '../workflows.js';

export interface StartedWorkflow {
  readonly workflowId: string;
  readonly runId: string;
  /** 同じ workflow id が既に走っていた（= 二重起動を防いだ）。 */
  readonly alreadyRunning: boolean;
}

export interface TaskRuntime {
  start(input: TaskWorkflowInput, workflowId: string): Promise<StartedWorkflow>;
  approve(workflowId: string, approvalId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void>;
  cancel(workflowId: string, reason: string): Promise<void>;
  describe(workflowId: string): Promise<TaskStateSnapshot | null>;
  close(): Promise<void>;
}

/** workflow id は決め打ちで導出する。二重起動の防波堤になる（実装仕様 §6.2）。 */
export function workflowIdFor(tenantId: string, taskId: string): string {
  return `task/${tenantId}/${taskId}`;
}

export const TASK_QUEUE = 'astra.task.v1';
