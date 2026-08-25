/** 接続設定。実装仕様 §5.4。 */

export interface DbConfig {
  /**
   * アプリ用の接続 URL。**非 superuser・非 BYPASSRLS のロール**であること（§4.4）。
   * superuser は FORCE ROW LEVEL SECURITY すら無視するため、ここを間違えると隔離が消える。
   */
  readonly url: string;
  /**
   * identity 用の接続 URL（任意）。認証はテナント確定前に走るので RLS 下では
   * users を引けない。BYPASSRLS だが identity テーブルにしか GRANT されていない
   * ロール `astra_identity` を使う（逸脱 D-14、infra/db/bootstrap.sql）。
   * 未設定なら `withIdentity` は明示的に失敗する。黙ってアプリロールへ落とさない。
   */
  readonly identityUrl?: string | undefined;
  readonly maxConnections: number;
  readonly identityMaxConnections: number;
  readonly idleTimeoutMillis: number;
  readonly connectionTimeoutMillis: number;
  /** 1 文あたりの上限。暴走クエリに接続を占有させない。 */
  readonly statementTimeoutMillis: number;
  /** pg_stat_activity で接続元が分かるようにする。 */
  readonly applicationName: string;
}

const int = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid numeric env value: ${value}`);
  return n;
};

export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return {
    url,
    identityUrl: env['ASTRA_DB_IDENTITY_URL'],
    maxConnections: int(env['ASTRA_DB_POOL_MAX'], 10),
    // identity は認証時にしか使わないので絞る。誤用を圧力で気づけるようにもする。
    identityMaxConnections: int(env['ASTRA_DB_IDENTITY_POOL_MAX'], 4),
    idleTimeoutMillis: int(env['ASTRA_DB_IDLE_TIMEOUT_MS'], 30_000),
    connectionTimeoutMillis: int(env['ASTRA_DB_CONNECT_TIMEOUT_MS'], 5_000),
    statementTimeoutMillis: int(env['ASTRA_DB_STATEMENT_TIMEOUT_MS'], 30_000),
    applicationName: env['ASTRA_DB_APPLICATION_NAME'] ?? 'astra',
  };
}
