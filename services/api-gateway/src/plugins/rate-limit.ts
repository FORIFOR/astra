/**
 * レート制限フック。実装仕様 §4.5。
 *
 * 制限の単位（IP / user / device）はルートごとに違うので、
 * ルート側が `config.rateLimit` で宣言する。宣言が無いルートは既定の一般 API 制限。
 */
import type { FastifyRequest } from 'fastify';
import { AstraError, RATE_LIMITS } from '@astra/contracts';
import type { App } from '../fastify.js';
import type { RateLimiter } from '../rate-limit/index.js';
import { currentRequestContext } from '../request-context.js';

export type RateLimitScope = 'ip' | 'user' | 'device';

export interface RouteRateLimit {
  readonly limit: number;
  readonly windowMs: number;
  readonly by: RateLimitScope;
  readonly bucket: string;
}

export const AUTH_RATE_LIMIT: RouteRateLimit = {
  limit: RATE_LIMITS.auth.limit,
  windowMs: RATE_LIMITS.auth.windowMs,
  by: 'ip',
  bucket: 'auth',
};

export const GENERAL_RATE_LIMIT: RouteRateLimit = {
  limit: RATE_LIMITS.general.limit,
  windowMs: RATE_LIMITS.general.windowMs,
  by: 'user',
  bucket: 'general',
};

export const CREATE_TASK_RATE_LIMIT: RouteRateLimit = {
  limit: RATE_LIMITS.createTask.limit,
  windowMs: RATE_LIMITS.createTask.windowMs,
  by: 'user',
  bucket: 'create-task',
};

function subjectFor(scope: RateLimitScope, request: FastifyRequest): string {
  const ctx = currentRequestContext();
  switch (scope) {
    case 'user':
      // 未認証なら IP へ落とす。認証前に user 単位で数えることはできない
      return ctx?.userId ? `u:${ctx.userId}` : `ip:${request.ip}`;
    case 'device':
      return ctx?.deviceId ? `d:${ctx.deviceId}` : `ip:${request.ip}`;
    case 'ip':
      return `ip:${request.ip}`;
  }
}

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: RouteRateLimit | false;
  }
}

export function registerRateLimit(app: App, limiter: RateLimiter): void {
  // 認証フックより後に走らせる（user 単位で数えるには user が確定している必要がある）
  app.addHook('preHandler', async (request, reply) => {
    const configured = request.routeOptions.config.rateLimit;
    if (configured === false) return;
    const rule = configured ?? GENERAL_RATE_LIMIT;

    const verdict = await limiter.consume(
      `${rule.bucket}:${subjectFor(rule.by, request)}`,
      rule.limit,
      rule.windowMs,
    );

    void reply.header('x-ratelimit-limit', String(verdict.limit));
    void reply.header('x-ratelimit-remaining', String(verdict.remaining));

    if (!verdict.allowed) {
      void reply.header('retry-after', String(Math.ceil(verdict.resetAfterMs / 1000)));
      throw new AstraError('common.rate_limited', `rate limit exceeded for ${rule.bucket}`);
    }
  });
}
