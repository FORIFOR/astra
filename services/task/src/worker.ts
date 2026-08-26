/**
 * Temporal worker。実装仕様 §6.2。
 *
 * ADR 0001 のとおり Phase 0〜3 は制御プレーンと同じプロセスで起動してよいが、
 * ワークフローのコードはサンドボックスで別に読み込まれるため、
 * 入口をここに 1 つだけ用意して bundle の起点を固定する。
 */
import path from 'node:path';
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

/**
 * ワークフロー定義の入口。
 *
 * 拡張子を自分自身から取る。`.js` 決め打ちにすると、tsx で src から起動したときに
 * 存在しない `src/workflows.js` を指して worker が上がらない（実際に踏んだ）。
 */
export function defaultWorkflowsPath(): string {
  const here = fileURLToPath(import.meta.url);
  const extension = path.extname(here) || '.js';
  return path.join(path.dirname(here), `workflows${extension}`);
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
