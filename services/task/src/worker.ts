/**
 * Temporal worker。実装仕様 §6.2。
 *
 * ADR 0001 のとおり Phase 0〜3 は制御プレーンと同じプロセスで起動してよいが、
 * ワークフローのコードはサンドボックスで別に読み込まれるため、
 * 入口をここに 1 つだけ用意して bundle の起点を固定する。
 */
import { fileURLToPath } from 'node:url';
import { Worker, type NativeConnection } from '@temporalio/worker';
import { createTaskActivities, type ActivityDeps } from './activities.js';
import { TASK_QUEUE } from './runtime/types.js';

export interface TaskWorkerOptions {
  readonly connection: NativeConnection;
  readonly namespace: string;
  readonly taskQueue?: string;
  /**
   * ワークフロー定義の入口。省略すると自身の `workflows` を使う。
   * テストは TypeScript の原本を直接指す。
   */
  readonly workflowsPath?: string;
}

export function defaultWorkflowsPath(): string {
  return fileURLToPath(new URL('./workflows.js', import.meta.url));
}

export async function createTaskWorker(
  deps: ActivityDeps,
  options: TaskWorkerOptions,
): Promise<Worker> {
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue ?? TASK_QUEUE,
    workflowsPath: options.workflowsPath ?? defaultWorkflowsPath(),
    activities: createTaskActivities(deps),
  });
}
