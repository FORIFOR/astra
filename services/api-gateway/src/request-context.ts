/**
 * リクエスト単位の相関情報。実装仕様 §13.1。
 *
 * `request_id` / `task_id` / `trace_id` を全ログ行に載せるため、
 * ハンドラの引数で持ち回さずに AsyncLocalStorage で保持する。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  tenantId?: string;
  userId?: string;
  deviceId?: string;
  taskId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string {
  return storage.getStore()?.requestId ?? 'no-request';
}
