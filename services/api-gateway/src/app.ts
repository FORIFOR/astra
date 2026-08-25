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
import type { TaskService } from '@astra/service-task';
import type { LibraryService } from '@astra/service-library';
import type { Logger } from '@astra/telemetry';
import { allowsDevelopmentRoutes, type GatewayConfig } from './config.js';
import { installErrorHandlers } from './errors.js';
import { normalizeRequestId, registerRequestId } from './plugins/request-id.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuth } from './auth/middleware.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { JwtTokens } from './auth/tokens.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import type { RateLimiter } from './rate-limit/index.js';
import type { App } from './fastify.js';

export interface AppDeps {
  readonly config: GatewayConfig;
  readonly db: DbHandle;
  readonly redis: Redis | null;
  readonly rateLimiter: RateLimiter;
  readonly logger: Logger;
  readonly tokens: JwtTokens;
  readonly tasks: TaskService;
  readonly library: LibraryService;
  /** SSE のポーリング間隔。テストは短くする。 */
  readonly ssePollIntervalMs?: number;
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

  // フックの登録順が実行順。認証はレート制限より前でなければならない
  // （user 単位で数えるには user が確定している必要がある。実装仕様 §11.1）
  registerRequestId(app);
  registerAuth(app, deps.tokens);
  registerRateLimit(app, deps.rateLimiter);
  installErrorHandlers(app);

  registerHealthRoutes(app, {
    db: deps.db,
    redis: deps.redis,
    version: deps.config.version,
  });
  registerAuthRoutes(app, {
    db: deps.db,
    tokens: deps.tokens,
    enableDevTokens: allowsDevelopmentRoutes(deps.config),
  });
  registerTaskRoutes(app, {
    tasks: deps.tasks,
    redis: deps.redis,
    ...(deps.ssePollIntervalMs === undefined ? {} : { ssePollIntervalMs: deps.ssePollIntervalMs }),
  });
  registerArtifactRoutes(app, { library: deps.library });

  return app;
}
