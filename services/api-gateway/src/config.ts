/** api-gateway の設定。実装仕様 §11。 */
import { existsSync } from 'node:fs';
import path from 'node:path';
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
  /** 同梱プラグインの場所。**絶対パス**に解決済み。 */
  readonly builtinPluginsDir: string;
  /** オブジェクト保存先。**絶対パス**に解決済み。 */
  readonly objectStoreRoot: string;
  /**
   * 会議の録音の置き場。**絶対パス**に解決済み。
   * STT より先に音を残すので、object store とは別に持つ（Phase 3 §3）。
   */
  readonly recordingRoot: string;
  /**
   * ブラウザから叩けるオリジン。
   * **既定は空**。許すオリジンは必ず明示させる（`*` を既定にしない）。
   */
  readonly allowedOrigins: readonly string[];
  /** 公開 viewer の場所。共有リンクの組み立てに使う。 */
  readonly shareHost: string;
  /**
   * requester のハッシュに混ぜる値。生の IP を監査へ残さないため（正本 §21）。
   * 変わると過去のログと突き合わせられなくなるので、環境ごとに固定する。
   */
  readonly requesterSalt: string;
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
    // 相対パスは cwd 依存で、どのディレクトリから起動したかで挙動が変わる。
    // ここで絶対化して、診断のときに実際に見た場所が分かるようにする。
    builtinPluginsDir: path.resolve(env['ASTRA_BUILTIN_PLUGINS_DIR'] ?? './plugins/builtin'),
    objectStoreRoot: path.resolve(env['ASTRA_OBJECT_STORE_ROOT'] ?? './.data/objects'),
    recordingRoot: path.resolve(env['ASTRA_RECORDING_ROOT'] ?? './.data/recordings'),
    allowedOrigins: parseOrigins(env['ASTRA_ALLOWED_ORIGINS'], parseEnvironment(env['ASTRA_ENV'])),
    shareHost: env['ASTRA_SHARE_HOST'] ?? 'http://localhost:1430',
    requesterSalt: env['ASTRA_REQUESTER_SALT'] ?? 'astra-development-salt',
  };
}

/**
 * CORS の許可オリジン。
 *
 * 開発では Vite（1420 / 1430）と Tauri の webview を通す。
 * それ以外の環境では **明示された値だけ**。`*` を既定にすると、
 * 認証済みの API が任意のサイトから叩けるようになる。
 */
function parseOrigins(raw: string | undefined, env: Environment): readonly string[] {
  const explicit = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;
  if (env === 'development' || env === 'test') {
    return [
      'http://localhost:1420',
      'http://127.0.0.1:1420',
      'http://localhost:1430',
      'http://127.0.0.1:1430',
      // Tauri の webview はこのオリジンで動く
      'tauri://localhost',
      'http://tauri.localhost',
    ];
  }
  return [];
}

/**
 * 起動前に、設定が指す場所が実在するか確かめる。
 *
 * 同梱プラグインが読めない状態で起動すると、カタログが空のまま「正常」に見える。
 * 起動時に落として、解決後の絶対パスを見せる方がよい。
 */
export function assertPathsExist(config: GatewayConfig): void {
  if (!existsSync(config.builtinPluginsDir)) {
    throw new Error(
      `bundled plugins not found at ${config.builtinPluginsDir}. ` +
        'Set ASTRA_BUILTIN_PLUGINS_DIR, or start the service from the repository root.',
    );
  }
}

/**
 * 開発専用の経路を登録してよいか。実装仕様 §4.3。
 * フラグで分岐するのではなく、**ルート自体を登録しない**ために使う。
 */
export function allowsDevelopmentRoutes(config: GatewayConfig): boolean {
  return config.env === 'development' || config.env === 'test';
}
