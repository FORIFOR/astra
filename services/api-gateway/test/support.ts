/** 結合テスト共通の組み立て。実物と同じ経路（buildApp）を通す。 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createDb, type DbConfig, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { InMemoryTaskRuntime, TaskService } from '@astra/service-task';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { ShareService } from '@astra/service-share';
import { buildApp } from '../src/app.js';
import type { HostBridge } from '../src/host/bridge.js';
import { MemoryRateLimiter } from '../src/rate-limit/memory.js';
import { loadSigningKeys } from '../src/auth/keys.js';
import { JwtTokens } from '../src/auth/tokens.js';
import type { Environment, GatewayConfig } from '../src/config.js';
import type { App } from '../src/fastify.js';

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

export function testDbConfig(url: string, identityUrl?: string, shareUrl?: string): DbConfig {
  return {
    url,
    identityUrl,
    shareUrl,
    shareMaxConnections: 2,
    maxConnections: 8,
    identityMaxConnections: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 20_000,
    applicationName: 'astra-test',
  };
}

export async function makeTokens(): Promise<JwtTokens> {
  return new JwtTokens({
    issuer: 'https://auth.astra.test',
    keys: await loadSigningKeys({ keyId: 'test-1' }),
  });
}

export interface TestApp {
  readonly app: App;
  readonly db: DbHandle;
  readonly tasks: TaskService;
  readonly library: LibraryService;
  readonly runtime: InMemoryTaskRuntime;
  readonly registry: PluginRegistryService;
  readonly shares: ShareService;
  close(): Promise<void>;
}

export interface MakeAppOptions {
  readonly db?: DbHandle;
  readonly dbConfig: DbConfig;
  readonly tokens: JwtTokens;
  readonly env?: Environment;
  /** ready() の前に呼ばれる。テスト専用ルートを足す用。 */
  readonly configure?: (app: App) => void;
  /** 同梱プラグインを DB へ seed するか。プラグインを見るテストだけ true。 */
  readonly seedPlugins?: boolean;
  readonly bridge?: HostBridge;
  readonly allowedOrigins?: readonly string[];
}

export async function makeTestApp(options: MakeAppOptions): Promise<TestApp> {
  const owned = options.db === undefined;
  const db = options.db ?? createDb(options.dbConfig);
  const storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-gw-'));
  const library = new LibraryService(db, new FsObjectStore(storeRoot));
  const runtime = new InMemoryTaskRuntime();
  const tasks = new TaskService(db, runtime);
  const registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
  const shares = new ShareService({ db, library, shareHost: 'http://localhost:1430' });
  if (options.seedPlugins) {
    await registry.seedBuiltins(
      fileURLToPath(new URL('../../../plugins/builtin', import.meta.url)),
    );
  }

  const config: GatewayConfig = {
    env: options.env ?? 'test',
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    redisUrl: undefined,
    version: '0.1.0',
    db: options.dbConfig,
    builtinPluginsDir: fileURLToPath(new URL('../../../plugins/builtin', import.meta.url)),
    objectStoreRoot: storeRoot,
    allowedOrigins: options.allowedOrigins ?? [],
    shareHost: 'http://localhost:1430',
    requesterSalt: 'test-salt',
  };

  const app = buildApp({
    config,
    db,
    redis: null,
    rateLimiter: new MemoryRateLimiter(),
    logger: createLogger({ service: 'test', level: 'silent' }, sink),
    tokens: options.tokens,
    tasks,
    library,
    registry,
    shares,
    ...(options.bridge === undefined ? {} : { bridge: options.bridge }),
    // テストは待ちたくないので短く回す
    ssePollIntervalMs: 20,
  });
  options.configure?.(app);
  await app.ready();

  return {
    app,
    db,
    tasks,
    library,
    runtime,
    registry,
    shares,
    async close() {
      await app.close();
      if (owned) await db.close();
    },
  };
}
