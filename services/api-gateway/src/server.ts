/** 起動エントリ。 */
import { Redis } from 'ioredis';
import { createDb } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { buildApp } from './app.js';
import { gatewayConfigFromEnv } from './config.js';
import { keyConfigFromEnv, loadSigningKeys } from './auth/keys.js';
import { JwtTokens } from './auth/tokens.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './rate-limit/index.js';

async function main(): Promise<void> {
  const config = gatewayConfigFromEnv();
  const logger = createLogger({
    service: 'api-gateway',
    version: config.version,
    level: config.logLevel,
    pretty: config.env === 'development',
  });

  const db = createDb(config.db);
  const redis = config.redisUrl ? new Redis(config.redisUrl) : null;

  if (!redis && config.env === 'production') {
    // プロセス内カウンタは水平スケールすると実質無制限になる
    throw new Error('REDIS_URL is required in production (in-memory rate limiting does not scale)');
  }
  const rateLimiter: RateLimiter = redis ? new RedisRateLimiter(redis) : new MemoryRateLimiter();

  const keys = await loadSigningKeys(keyConfigFromEnv(), logger);
  if (keys.ephemeral && config.env === 'production') {
    // 再起動のたびに全トークンが無効になる
    throw new Error('ASTRA_JWT_PRIVATE_KEY / ASTRA_JWT_PUBLIC_KEY are required in production');
  }
  const tokens = new JwtTokens({
    issuer: process.env['ASTRA_JWT_ISSUER'] ?? 'https://auth.astra.local',
    keys,
  });

  const app = buildApp({ config, db, redis, rateLimiter, logger, tokens });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await rateLimiter.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, env: config.env }, 'api-gateway listening');
}

main().catch((error: unknown) => {
  // ここで落ちるのは起動不能。握りつぶさず終了コードで知らせる。
  console.error(error);
  process.exit(1);
});
