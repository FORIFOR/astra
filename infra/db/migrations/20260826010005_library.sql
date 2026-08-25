-- Library。実装仕様 §5.3・§8。
-- migrate:up

CREATE TABLE artifacts (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  owner_id            uuid NOT NULL REFERENCES users(id),
  type                text NOT NULL CHECK (type IN
                        ('REPORT','DOCUMENT','TRANSCRIPT','MEETING_BUNDLE','IMAGE','VIDEO',
                         'AUDIO','CODE','DATASET','OTHER')),
  title               text NOT NULL,
  mime_type           text NOT NULL,
  source_agent_id     text,
  source_task_id      uuid REFERENCES tasks(id),
  source_meeting_id   uuid,                    -- FK は Phase 3 の meetings 作成時に付与
  parent_artifact_id  uuid REFERENCES artifacts(id),
  current_version     int  NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  tags                text[] NOT NULL DEFAULT '{}',
  entities            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- Phase 6 まで空
  lineage             jsonb NOT NULL DEFAULT '[]'::jsonb,  -- Phase 6 まで空
  sensitivity         text NOT NULL DEFAULT 'PRIVATE'
                      CHECK (sensitivity IN ('PUBLIC','PRIVATE','CONFIDENTIAL','REGULATED')),
  searchable_text_ref text,                    -- Phase 2 のセマンティック検索用
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Library の既定は「最近使ったもの」（正本 §2.3）。id を tiebreak にしてカーソルを安定させる
CREATE INDEX artifacts_recent ON artifacts (tenant_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX artifacts_by_task ON artifacts (source_task_id) WHERE source_task_id IS NOT NULL;
CREATE INDEX artifacts_by_type ON artifacts (tenant_id, type, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE artifact_versions (
  artifact_id uuid NOT NULL REFERENCES artifacts(id),
  version     int  NOT NULL CHECK (version >= 1),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  object_key  text NOT NULL,
  size        bigint NOT NULL CHECK (size >= 0),
  sha256      char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, version)
);
-- 同一テナント内の内容重複を検出して object の再アップロードを省く（実装仕様 §8.3）
CREATE INDEX artifact_versions_sha ON artifact_versions (tenant_id, sha256);

ALTER TABLE tasks ADD CONSTRAINT tasks_result_artifact_fk
  FOREIGN KEY (result_artifact_id) REFERENCES artifacts(id);

-- migrate:down
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_result_artifact_fk;
DROP TABLE IF EXISTS artifact_versions;
DROP TABLE IF EXISTS artifacts;
