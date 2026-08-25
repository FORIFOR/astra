/** api-gateway の設定。実装仕様 §11。 */
import { dbConfigFromEnv, type DbConfig } from '@astra/db';

export type Environment = 'development' | 'test' | 'staging' | 'production';

export interface GatewayConfig {
  readonly env: Environment;
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
  readonly redisUrl: string | undefined;
  readonly db: DbConfig;
  /** ヘルスチェックと診断に載せるアプリ版。plugin の互換判定にも使う。 */
  readonly version: string;
}

const ENVIRONMENTS: readonly Environment[] = ['development', 'test', 'staging', 'production'];

function parseEnvironment(value: string | undefined): Environment {
  const env = value ?? 'development';
  if (!ENVIRONMENTS.includes(env as Environment)) {
    throw new Error(`ASTRA_ENV must be one of ${ENVIRONMENTS.join(', ')}, got "${env}"`);
  }
  return env as Environment;
}

export function gatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    env: parseEnvironment(env['ASTRA_ENV']),
    port: Number.parseInt(env['ASTRA_API_PORT'] ?? '3000', 10),
    host: env['ASTRA_API_HOST'] ?? '0.0.0.0',
    logLevel: env['ASTRA_LOG_LEVEL'] ?? 'info',
    redisUrl: env['REDIS_URL'],
    db: dbConfigFromEnv(env),
    version: env['ASTRA_VERSION'] ?? '0.1.0',
  };
}

/**
 * 開発専用の経路を登録してよいか。実装仕様 §4.3。
 * フラグで分岐するのではなく、**ルート自体を登録しない**ために使う。
 */
export function allowsDevelopmentRoutes(config: GatewayConfig): boolean {
  return config.env === 'development' || config.env === 'test';
}
