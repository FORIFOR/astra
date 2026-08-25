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
export { JwtTokens, bearerToken, type Principal, type TokenVerifier } from './auth/tokens.js';
export { loadSigningKeys, keyConfigFromEnv, type SigningKeys } from './auth/keys.js';
export { requirePrincipal } from './auth/middleware.js';
export { registerTaskRoutes, type TaskRouteDeps } from './routes/tasks.js';
export { registerArtifactRoutes, type ArtifactRouteDeps } from './routes/artifacts.js';
export { registerPluginRoutes, type PluginRouteDeps } from './routes/plugins.js';
export { HostBridge, type HostCallOptions, type HostSocket } from './host/bridge.js';
export { registerHostRoutes, extractDeviceToken, type HostRouteDeps } from './host/routes.js';
export {
  pumpEventStream,
  parseLastEventId,
  pollingWaker,
  redisWaker,
  type EventWaker,
} from './routes/sse.js';
export {
  createSession,
  rotateRefreshToken,
  revokeSession,
  revokeDeviceSessions,
  countActiveSessions,
} from './auth/sessions.js';
