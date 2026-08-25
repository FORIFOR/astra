/** 接続プールと Kysely インスタンス。実装仕様 §5.4。 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DbConfig } from './config.js';
import type { Database } from './types.js';

// int8 は既定で number へ落とされ 2^53 を超えると桁が壊れる。string で受け、
// 変換は呼び出し側が BigInt() / Number() で明示する（sequence は bigint）。
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

export type Db = Kysely<Database>;

export interface DbHandle {
  /** テナントスコープと非 RLS カタログ用。RLS が効くロール。 */
  readonly app: Db;
  /** 認証専用。identity テーブルにしか権限が無い BYPASSRLS ロール。未設定なら null。 */
  readonly identity: Db | null;
  close(): Promise<void>;
}

function makePool(url: string, config: DbConfig, max: number, suffix: string): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    application_name: `${config.applicationName}:${suffix}`,
    options: `-c statement_timeout=${config.statementTimeoutMillis}`,
  });
}

export function createDb(config: DbConfig): DbHandle {
  const appPool = makePool(config.url, config, config.maxConnections, 'app');
  const app = new Kysely<Database>({ dialect: new PostgresDialect({ pool: appPool }) });

  let identity: Db | null = null;
  if (config.identityUrl) {
    const identityPool = makePool(
      config.identityUrl,
      config,
      config.identityMaxConnections,
      'identity',
    );
    identity = new Kysely<Database>({ dialect: new PostgresDialect({ pool: identityPool }) });
  }

  return {
    app,
    identity,
    async close() {
      await app.destroy();
      if (identity) await identity.destroy();
    },
  };
}
