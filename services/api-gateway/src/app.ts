/**
 * api-gateway の組み立て。実装仕様 §2.3・§11。
 *
 * ADR 0001 のとおり Phase 0〜3 は各サービスを in-process で composition する。
 * 依存は引数で受け取る（テストが実物と同じ経路を通れるようにするため）。
 */
import Fastify from 'fastify';
import { HEADER_REQUEST_ID } from '@astra/contracts';
import type { Redis } from 'ioredis';
import type { DbHandle } from '@astra/db';
import type { Logger } from '@astra/telemetry';
import type { GatewayConfig } from './config.js';
import { installErrorHandlers } from './errors.js';
import { normalizeRequestId, registerRequestId } from './plugins/request-id.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerHealthRoutes } from './routes/health.js';
import type { RateLimiter } from './rate-limit/index.js';
import type { App } from './fastify.js';

export interface AppDeps {
  readonly config: GatewayConfig;
  readonly db: DbHandle;
  readonly redis: Redis | null;
  readonly rateLimiter: RateLimiter;
  readonly logger: Logger;
}

export function buildApp(deps: AppDeps): App {
  const app = Fastify({
    loggerInstance: deps.logger,
    // request id は Fastify の reqId として一度だけ確定させる。
    // フック側で採番し直すと、Fastify のログ行と自前のログ行で id がずれる。
    genReqId: (req) => normalizeRequestId(req.headers[HEADER_REQUEST_ID]),
    // プロキシ配下で client IP を正しく取る。レート制限のキーになるので重要。
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  registerRequestId(app);
  registerRateLimit(app, deps.rateLimiter);
  installErrorHandlers(app);

  registerHealthRoutes(app, {
    db: deps.db,
    redis: deps.redis,
    version: deps.config.version,
  });

  return app;
}
