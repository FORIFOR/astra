-- 監査。正本 §21、実装仕様 §5.3・§13.2。
-- ハッシュ連鎖で改竄を検出可能にする（受け入れテスト AC-15）。
-- migrate:up

-- テナント単位の連番採番元。event_streams と同じ方式で欠番を作らない。
CREATE TABLE audit_sequences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  next_seq  bigint NOT NULL DEFAULT 1 CHECK (next_seq >= 1)
);

CREATE TABLE audit_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  seq             bigint NOT NULL CHECK (seq >= 1),
  actor_type      text NOT NULL CHECK (actor_type IN ('user','agent','system','service')),
  actor_id        text,
  action          text NOT NULL,
  task_id         uuid,
  tool_id         text,
  external_effect boolean NOT NULL DEFAULT false,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash       char(64) CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash            char(64) NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 連鎖の先頭だけ prev_hash が NULL
  CONSTRAINT audit_events_chain_root CHECK ((seq = 1) = (prev_hash IS NULL))
);
CREATE UNIQUE INDEX audit_events_chain ON audit_events (tenant_id, seq);
CREATE UNIQUE INDEX audit_events_prev ON audit_events (tenant_id, prev_hash)
  WHERE prev_hash IS NOT NULL;
CREATE INDEX audit_events_by_action ON audit_events (tenant_id, action, seq DESC);
CREATE INDEX audit_events_external ON audit_events (tenant_id, seq DESC) WHERE external_effect;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

-- migrate:down
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS audit_sequences;
