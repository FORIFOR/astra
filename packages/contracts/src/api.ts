/** Phase 0 の HTTP 表面。実装仕様 §11。ここに無いエンドポイントは Phase 0 で実装しない。 */
import { z } from 'zod';
import { Task } from './task.js';
import { Artifact } from './artifact.js';
import { PluginCatalogEntry } from './plugin.js';
import { pageResponse } from './primitives.js';

export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_CLIENT = 'x-astra-client';
export const HEADER_LAST_EVENT_ID = 'last-event-id';

/** POST /v1/tasks の Idempotency-Key 保持期間（実装仕様 §11）。 */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

export const IdempotencyKey = z.string().min(8).max(128);

export const TaskListResponse = pageResponse(Task);
export const ArtifactListResponse = pageResponse(Artifact);
export const PluginCatalogResponse = z.object({ items: z.array(PluginCatalogEntry) });

/** レート制限の既定値（実装仕様 §4.5）。 */
export const RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60_000, by: 'ip' },
  general: { limit: 300, windowMs: 60_000, by: 'user' },
  createTask: { limit: 60, windowMs: 60_000, by: 'user' },
  sseConnections: { limit: 8, by: 'device' },
} as const;

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  checks: z.record(z.string(), z.enum(['ok', 'down'])).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
