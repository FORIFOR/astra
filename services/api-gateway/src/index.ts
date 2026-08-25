/**
 * @astra/service-api-gateway
 *
 * 認証・テナントルーティング・レート制限・REST の入口。実装仕様 §11・§17。
 */
export { buildApp, type AppDeps } from './app.js';
export type { App } from './fastify.js';
export { gatewayConfigFromEnv, allowsDevelopmentRoutes, type GatewayConfig } from './config.js';
export { toApiError } from './errors.js';
export {
  currentRequestContext,
  currentRequestId,
  runWithRequestContext,
  type RequestContext,
} from './request-context.js';
export { normalizeRequestId } from './plugins/request-id.js';
export {
  AUTH_RATE_LIMIT,
  CREATE_TASK_RATE_LIMIT,
  GENERAL_RATE_LIMIT,
  type RouteRateLimit,
} from './plugins/rate-limit.js';
export { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './rate-limit/index.js';
