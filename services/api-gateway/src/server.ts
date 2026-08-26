/** 起動エントリ。 */
import { Redis } from 'ioredis';
import { createDb } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { TaskService, TemporalTaskRuntime } from '@astra/service-task';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { ShareService } from '@astra/service-share';
import {
  FsRecordingStore,
  MeetingService,
  assertNoStandIns,
  meetingProvidersFromEnv,
  standIns as meetingStandIns,
} from '@astra/service-meeting';
import { buildApp } from './app.js';
import { assertPathsExist, gatewayConfigFromEnv } from './config.js';
import { keyConfigFromEnv, loadSigningKeys } from './auth/keys.js';
import { JwtTokens } from './auth/tokens.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './rate-limit/index.js';

async function main(): Promise<void> {
  const config = gatewayConfigFromEnv();
  assertPathsExist(config);
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

  const library = new LibraryService(db, new FsObjectStore(config.objectStoreRoot));
  const runtime = await TemporalTaskRuntime.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    // 環境ごとに分ける。同じ queue を共有すると、片方の使い捨て DB に紐づく
    // ワークフローがもう片方の worker の枠を食う（実際に踏んだ）。
    ...(process.env['ASTRA_TASK_QUEUE'] ? { taskQueue: process.env['ASTRA_TASK_QUEUE'] } : {}),
  });
  const tasks = new TaskService(db, runtime);
  const shares = new ShareService({ db, library, shareHost: config.shareHost });
  const registry = new PluginRegistryService({ db, coreVersion: config.version });

  // STT は設定されていれば本物、無ければ代役（Phase 3 §10 OQ-11）。
  const meetingProviders = await meetingProvidersFromEnv(process.env);
  const remaining = meetingStandIns(meetingProviders);
  const { warn } = assertNoStandIns(remaining, config.env);
  if (warn) logger.warn({ stand_ins: remaining }, warn);
  const meetings = new MeetingService({
    db,
    publisher: { async publish() {} },
    translator: meetingProviders.translation,
  });
  // 同梱プラグインは起動のたびに読み直す。バンドルが正、DB はその写し。
  await registry.seedBuiltins(config.builtinPluginsDir);

  const app = buildApp({
    config,
    db,
    redis,
    rateLimiter,
    logger,
    tokens,
    tasks,
    library,
    registry,
    // Phase 2 の共有経路。渡し忘れると本番だけ 404 になる（実際に抜けていた）。
    shares,
    meetings: {
      meetings,
      recordings: new FsRecordingStore(config.recordingRoot),
      transcriber: meetingProviders.streaming,
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await rateLimiter.close();
    await runtime.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  logger.info(
    {
      port: config.port,
      env: config.env,
      plugins_dir: config.builtinPluginsDir,
      object_store: config.objectStoreRoot,
    },
    'api-gateway listening',
  );
}

main().catch((error: unknown) => {
  // ここで落ちるのは起動不能。握りつぶさず終了コードで知らせる。
  console.error(error);
  process.exit(1);
});
