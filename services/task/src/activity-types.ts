/** activity の型。ワークフロー側から見える契約なので、実装から分離しておく。 */
import type { TaskStep } from './plan.js';
import type { TaskWorkflowInput } from './workflows.js';

export interface TaskErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly step_index: number | null;
  readonly retryable: boolean;
}

export interface StartTaskMeta {
  readonly kind: string;
  readonly title: string;
  readonly step_count: number;
  readonly run_id: string;
}

export interface ArtifactSpec {
  readonly type: 'REPORT' | 'DOCUMENT' | 'OTHER';
  readonly title: string;
  readonly mimeType: string;
}

export interface RequestedApproval {
  readonly approvalId: string;
}

export interface TaskActivities {
  startTask(input: TaskWorkflowInput, meta: StartTaskMeta): Promise<void>;
  requestApprovalIfNeeded(
    input: TaskWorkflowInput,
    step: TaskStep,
  ): Promise<RequestedApproval | null>;
  acceptApproval(input: TaskWorkflowInput, approvalId: string): Promise<void>;
  rejectApproval(input: TaskWorkflowInput, approvalId: string, stepIndex: number): Promise<void>;
  expireApproval(input: TaskWorkflowInput, approvalId: string): Promise<void>;
  executeStep(input: TaskWorkflowInput, step: TaskStep): Promise<unknown>;
  composeArtifact(
    input: TaskWorkflowInput,
    spec: ArtifactSpec,
    results: readonly unknown[],
  ): Promise<string>;
  completeTask(input: TaskWorkflowInput, artifactId: string): Promise<void>;
  failTask(input: TaskWorkflowInput, error: TaskErrorPayload): Promise<void>;
  cancelTask(input: TaskWorkflowInput, reason: string): Promise<void>;
}
