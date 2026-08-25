-- Task / イベント列 / 承認 / 実行レシート。実装仕様 §5.3・§6・§7。
-- migrate:up

CREATE TABLE tasks (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  conversation_id    uuid REFERENCES conversations(id),
  kind               text NOT NULL,
  title              text,
  status             text NOT NULL CHECK (status IN
                       ('PENDING','RUNNING','WAITING_APPROVAL','CANCELLING',
                        'COMPLETED','FAILED','CANCELLED')),
  input              jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_artifact_id uuid,                   -- FK は library マイグレーションで付与
  error              jsonb,
  idempotency_key    text NOT NULL,
  workflow_id        text NOT NULL,
  run_id             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 正本 §24「重複実行しない」。API 層の一次防御（二次防御は Temporal の workflow id 一意性）
CREATE UNIQUE INDEX tasks_idempotency ON tasks (tenant_id, created_by, idempotency_key);
CREATE UNIQUE INDEX tasks_workflow_id ON tasks (workflow_id);
-- カーソルページングは UUIDv7 の時系列性を使うので (tenant_id, id DESC) で足りる
CREATE INDEX tasks_recent ON tasks (tenant_id, id DESC);
CREATE INDEX tasks_active ON tasks (tenant_id, status)
  WHERE status IN ('PENDING','RUNNING','WAITING_APPROVAL','CANCELLING');

-- sequence の採番元。stream 単位で 1 始まり・欠番なしを保証する（実装仕様 §7.2）
CREATE TABLE event_streams (
  stream_kind text NOT NULL CHECK (stream_kind IN ('task','conversation','meeting')),
  stream_id   uuid NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  next_seq    bigint NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_kind, stream_id)
);

CREATE TABLE task_events (
  event_id        uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  stream_kind     text NOT NULL,
  stream_id       uuid NOT NULL,
  sequence        bigint NOT NULL CHECK (sequence >= 1),
  type            text NOT NULL,
  task_id         uuid REFERENCES tasks(id),
  conversation_id uuid REFERENCES conversations(id),
  payload         jsonb NOT NULL,
  -- activity 再実行時の重複挿入防止（実装仕様 §6.4）
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (stream_kind, stream_id) REFERENCES event_streams (stream_kind, stream_id)
);

-- リプレイ（sequence > last_event_id の昇順読み出し）はこの一意索引だけで賄える。
-- payload を INCLUDE しない: jsonb は TOAST され得るので索引を肥大させる。
CREATE UNIQUE INDEX task_events_stream_seq ON task_events (stream_kind, stream_id, sequence);
CREATE UNIQUE INDEX task_events_idem
  ON task_events (stream_kind, stream_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- イベントは追記のみ
CREATE TRIGGER task_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON task_events
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

CREATE TABLE approvals (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  task_id         uuid NOT NULL REFERENCES tasks(id),
  step_index      int  NOT NULL,
  risk            text NOT NULL CHECK (risk IN
                    ('READ','REVERSIBLE_WRITE','EXTERNAL_COMMIT','DESTRUCTIVE','REGULATED','FINANCIAL')),
  summary         text NOT NULL,
  details         jsonb NOT NULL DEFAULT '[]'::jsonb,
  editable_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  expires_at      timestamptz NOT NULL,
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 決定済みなら決定者と時刻が揃っていること
  CONSTRAINT approvals_decision_complete CHECK (
    (status IN ('PENDING','EXPIRED') AND decided_at IS NULL)
    OR (status IN ('APPROVED','REJECTED') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);
-- requestApproval activity の冪等化（実装仕様 §6.4）
CREATE UNIQUE INDEX approvals_task_step ON approvals (task_id, step_index);
CREATE INDEX approvals_pending ON approvals (tenant_id, expires_at) WHERE status = 'PENDING';

-- 正本 §9.4。append-only（AC-16）
CREATE TABLE action_receipts (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  task_id          uuid NOT NULL REFERENCES tasks(id),
  tool_id          text NOT NULL,
  actor            text NOT NULL CHECK (actor IN ('user','agent','system')),
  inputs_hash      char(64) NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  result_ref       text,
  risk             text NOT NULL,
  approved_by      uuid REFERENCES users(id),
  reversible_until timestamptz,
  executed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX action_receipts_idem ON action_receipts (task_id, tool_id, inputs_hash);
CREATE INDEX action_receipts_by_task ON action_receipts (tenant_id, task_id);

CREATE TRIGGER action_receipts_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON action_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

-- migrate:down
DROP TABLE IF EXISTS action_receipts;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS task_events;
DROP TABLE IF EXISTS event_streams;
DROP TABLE IF EXISTS tasks;
