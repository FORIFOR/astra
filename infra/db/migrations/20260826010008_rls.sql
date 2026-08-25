-- Row Level Security。実装仕様 §4.4（二重防御の DB 層）。
--
-- 方針:
--   * 既定は deny。`app.tenant_id` が未設定なら 1 行も見えない。
--   * FORCE ROW LEVEL SECURITY を付け、テーブル所有者にもポリシーを適用する。
--   * plugin_publishers / plugins / plugin_versions はテナント横断のカタログなので対象外。
--
-- 前提: アプリは **superuser でも BYPASSRLS でもないロール**で接続すること。
--       superuser / BYPASSRLS は FORCE を含め RLS を無視する。infra/db/bootstrap.sql 参照。
-- migrate:up

CREATE FUNCTION astra_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- tenant_id 列を持つテーブルへ一律にポリシーを張る
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'memberships','devices','sessions',
    'conversations','turns',
    'tasks','event_streams','task_events','approvals','action_receipts',
    'artifacts','artifact_versions',
    'plugin_installs','plugin_permissions',
    'audit_sequences','audit_events'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = astra_current_tenant())'
      ' WITH CHECK (tenant_id = astra_current_tenant())',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- tenants 自身: 自テナントの行だけ
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_tenant_isolation ON tenants
  USING (id = astra_current_tenant())
  WITH CHECK (id = astra_current_tenant());

-- users はテナント横断の実体（同一人物が複数テナントに所属し得る）。
-- 自テナントに所属しているユーザーだけを見せる。
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_isolation ON users
  USING (EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = users.id AND m.tenant_id = astra_current_tenant()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = users.id AND m.tenant_id = astra_current_tenant()));

-- migrate:down
DO $$
DECLARE
  t text;
  all_tables text[] := ARRAY[
    'memberships','devices','sessions','conversations','turns',
    'tasks','event_streams','task_events','approvals','action_receipts',
    'artifacts','artifact_versions','plugin_installs','plugin_permissions',
    'audit_sequences','audit_events','tenants','users'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS astra_current_tenant();
