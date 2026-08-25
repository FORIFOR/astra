-- クラスタ側の前提。マイグレーションではなく運用手順（ロールはデータベースを跨ぐため）。
-- 本番では terraform / Cloud SQL の IAM で同等の構成を作る。
--
--   psql "$ADMIN_DATABASE_URL" -f infra/db/bootstrap.sql
--
-- 重要: astra_app は superuser でも BYPASSRLS でもない。
--       superuser は FORCE ROW LEVEL SECURITY すら無視するため、
--       アプリが superuser で繋いだ瞬間にテナント隔離が消える（実装仕様 §4.4）。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'astra_app') THEN
    CREATE ROLE astra_app LOGIN PASSWORD 'astra_app';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'astra_migrate') THEN
    -- マイグレーションと世界横断の保守だけがこのロールを使う
    CREATE ROLE astra_migrate LOGIN PASSWORD 'astra_migrate' BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO astra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO astra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO astra_app;
