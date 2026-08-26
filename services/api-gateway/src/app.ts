/**
 * api-gateway の組み立て。実装仕様 §2.3・§11。
 *
 * ADR 0001 のとおり Phase 0〜3 は各サービスを in-process で composition する。
 * 依存は引数で受け取る（テストが実物と同じ経路を通れるようにするため）。
 */
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { HEADER_REQUEST_ID } from '@astra/contracts';
import type { Redis } from 'ioredis';
import type { DbHandle } from '@astra/db';
import type { TaskService } from '@astra/service-task';
import type { LibraryService } from '@astra/service-library';
import type { PluginRegistryService } from '@astra/service-plugin-registry';
import type { ShareService } from '@astra/service-share';
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
import { registerPluginRoutes } from './routes/plugins.js';
import { registerShareRoutes } from './routes/shares.js';
import type { DataSourceResolver } from '@astra/service-plugin-registry';
import {
  registerMeetingAudioRoute,
  registerMeetingRoutes,
  type MeetingRuntime,
} from './routes/meetings.js';
import { HostBridge } from './host/bridge.js';
import { registerHostRoutes } from './host/routes.js';
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
  readonly registry: PluginRegistryService;
  readonly shares?: ShareService;
  readonly meetings?: MeetingRuntime;
  /** dashboard の bind を解決する先。gateway が各サービスの束を合成して渡す。 */
  readonly dataSources?: DataSourceResolver;
  readonly bridge?: HostBridge;
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

  // CORS はフックより前。preflight は認証もレート制限も通さない。
  void app.register(cors, {
    origin: deps.config.allowedOrigins.length > 0 ? [...deps.config.allowedOrigins] : false,
    credentials: false,
    // 明示しないと DELETE が preflight の許可に載らず、ブラウザからの
    // uninstall が弾かれる（実際に踏んだ）。
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    // SSE の再開に要る。露出させないとクライアントが読めない。
    exposedHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-request-id',
      'last-event-id',
    ],
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
  registerPluginRoutes(app, {
    registry: deps.registry,
    ...(deps.dataSources === undefined ? {} : { dataSources: deps.dataSources }),
  });
  if (deps.meetings) {
    registerMeetingRoutes(app, {
      ...deps.meetings,
      tasks: deps.tasks,
      tokens: deps.tokens,
      logger: deps.logger,
      redis: deps.redis,
      ...(deps.ssePollIntervalMs === undefined
        ? {}
        : { ssePollIntervalMs: deps.ssePollIntervalMs }),
    });
  }
  if (deps.shares) {
    registerShareRoutes(app, {
      shares: deps.shares,
      tokens: deps.tokens,
      db: deps.db,
      rateLimiter: deps.rateLimiter,
      requesterSalt: deps.config.requesterSalt,
      shareHost: deps.config.shareHost,
    });
  }

  // WebSocket のルートは、プラグインの読み込みが終わったスコープで登録する。
  // 同じ tick で app.register(websocket) の直後に足すと、まだ `websocket: true` を
  // 解釈できず通常の HTTP ルートとして登録されてしまう。
  const bridge = deps.bridge ?? new HostBridge({ logger: deps.logger });
  void app.register(async (instance) => {
    await instance.register(websocket);
    registerHostRoutes(instance as unknown as App, {
      bridge,
      tokens: deps.tokens,
      logger: deps.logger,
    });
    if (deps.meetings) {
      registerMeetingAudioRoute(instance as unknown as App, {
        ...deps.meetings,
        tasks: deps.tasks,
        tokens: deps.tokens,
        logger: deps.logger,
        redis: deps.redis,
      });
    }
  });

  return app;
}
