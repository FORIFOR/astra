-- 初期セットアップ。正本 §3。
-- migrate:up

-- 利用者ごとに 1 行。テナントを跨いで入り直しても、テナントごとに別。
CREATE TABLE onboarding_states (
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  user_id             uuid NOT NULL REFERENCES users(id),
  step                text NOT NULL DEFAULT 'promise' CHECK (step IN (
    'promise','input_preference','interests','packs','permissions','shortcut','first_task','done'
  )),
  -- 選んでも機能制限はしない（§3 Step 2）。出だしの見せ方だけ変える。
  input_preference    text CHECK (input_preference IN ('voice','text','both')),
  interests           text[] NOT NULL DEFAULT '{}',
  installed_plugins   text[] NOT NULL DEFAULT '{}',
  -- **許可の記録**であって、求めた記録ではない
  granted_permissions text[] NOT NULL DEFAULT '{}',
  -- §3 Step 7。実際に完了させた task。**やっていなければ null。**
  first_task_id       uuid REFERENCES tasks(id),
  completed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  -- 終わったと言うなら、成功体験が要る（§3 Step 7）
  CONSTRAINT onboarding_done_needs_a_first_task
    CHECK (completed_at IS NULL OR first_task_id IS NOT NULL)
);

ALTER TABLE onboarding_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_states FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_states_tenant_isolation ON onboarding_states
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS onboarding_states;
