-- Work Context / Personalization Layer。正本 §6・§10、Phase 6。
-- migrate:up

-- 正規化した 1 件（メール・予定・タスク・会議の抜粋）。**全文は持たない**（body_excerpt <= 500 字）。
-- 端末の worker が push する。source + external_id で一意（同じものを二度取り込まない）。
CREATE TABLE work_artifacts (
  id           text NOT NULL,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL,
  source       text NOT NULL CHECK (source IN (
    'gmail','google_calendar','google_tasks','outlook_mail','outlook_calendar','microsoft_todo','planner',
    'meeting','screenshot','file','astra_task','browser'
  )),
  kind         text NOT NULL CHECK (kind IN (
    'email','calendar_event','task','meeting','file','message','commitment','decision','action_item'
  )),
  occurred_at  timestamptz NOT NULL,
  due_at       timestamptz,
  thread_id    text,
  -- WorkArtifact 全体（contracts/work.ts）。列は検索と並べ替えに要るものだけ取り出す。
  body         jsonb NOT NULL,
  observed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, id)
);
CREATE INDEX work_artifacts_recent ON work_artifacts (tenant_id, user_id, occurred_at DESC);
COMMENT ON COLUMN work_artifacts.body IS 'contracts WorkArtifact。body_excerpt は抜粋（<= 500 字）で、メール全文は決して入らない';

-- 利用者の訂正（「これは優先ではない」「終わった」）。以後の推論に効く。消さない（監査）。
CREATE TABLE work_corrections (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL,
  item_id    text NOT NULL,
  action     text NOT NULL CHECK (action IN ('dismiss','not_priority','done','wrong_project')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_corrections_user ON work_corrections (tenant_id, user_id, created_at DESC);

-- Personalization の本人による上書き（observed / inferred / confirmed と enabled、全体の停止）。
-- 推測そのものは保存しない（毎回 artifact から導く）。保存するのは本人の意思だけ。
CREATE TABLE work_profiles (
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  user_id           uuid NOT NULL,
  inference_enabled boolean NOT NULL DEFAULT true,
  overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- 端末の同期位置（source ごと）。cursor は提供者の値（historyId / deltaLink / 時刻）をそのまま持つ。
CREATE TABLE work_sync_state (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL,
  source        text NOT NULL,
  cursor        text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  artifact_count int NOT NULL DEFAULT 0 CHECK (artifact_count >= 0),
  PRIMARY KEY (tenant_id, user_id, source)
);

ALTER TABLE work_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY work_artifacts_tenant ON work_artifacts USING (tenant_id = astra_current_tenant()) WITH CHECK (tenant_id = astra_current_tenant());
ALTER TABLE work_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY work_corrections_tenant ON work_corrections USING (tenant_id = astra_current_tenant()) WITH CHECK (tenant_id = astra_current_tenant());
ALTER TABLE work_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY work_profiles_tenant ON work_profiles USING (tenant_id = astra_current_tenant()) WITH CHECK (tenant_id = astra_current_tenant());
ALTER TABLE work_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_sync_state FORCE ROW LEVEL SECURITY;
CREATE POLICY work_sync_state_tenant ON work_sync_state USING (tenant_id = astra_current_tenant()) WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS work_sync_state;
DROP TABLE IF EXISTS work_profiles;
DROP TABLE IF EXISTS work_corrections;
DROP TABLE IF EXISTS work_artifacts;
