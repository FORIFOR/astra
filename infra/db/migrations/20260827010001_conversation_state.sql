-- Conversation Engine の状態と圧縮。正本 §7.3、Phase 7 実装仕様 §2。
-- migrate:up

-- 正本 §7.3 の ConversationState。会話ごとに 1 行。
CREATE TABLE conversation_states (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  active_topic    text,
  active_project  text,
  active_person   text,
  active_artifact uuid REFERENCES artifacts(id),
  active_task     uuid REFERENCES tasks(id),
  active_meeting  uuid REFERENCES meetings(id),
  -- 「それ」「2番」の解決先。0 が直近。
  referents       jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_approvals uuid[] NOT NULL DEFAULT '{}',
  response_mode   text NOT NULL DEFAULT 'text' CHECK (response_mode IN ('text','voice','mixed')),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 打ち切られた応答も残す。**出した分は消さない**（D-50）。
ALTER TABLE turns ADD COLUMN interrupted boolean NOT NULL DEFAULT false;

-- 直近以外を畳んだもの。**捨てたのではなく畳んだ**ことが分かるように残す。
CREATE TABLE conversation_summaries (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  covers_from     uuid NOT NULL REFERENCES turns(id),
  covers_to       uuid NOT NULL REFERENCES turns(id),
  turn_count      int NOT NULL CHECK (turn_count > 0),
  summary         text NOT NULL CHECK (summary <> ''),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_summaries_by_conversation
  ON conversation_summaries (conversation_id, id);

-- 要約は記録。後から書き換えない。
CREATE TRIGGER conversation_summaries_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON conversation_summaries
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

ALTER TABLE conversation_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_states FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_states_tenant_isolation ON conversation_states
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_summaries_tenant_isolation ON conversation_summaries
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS conversation_summaries;
DROP TABLE IF EXISTS conversation_states;
ALTER TABLE turns DROP COLUMN IF EXISTS interrupted;
