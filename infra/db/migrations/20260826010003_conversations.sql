-- 会話。逸脱 D-06: 実装は Phase 1 だが tasks.conversation_id の参照先が要るため DDL は Phase 0 で作る。
-- migrate:up

CREATE TABLE conversations (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL REFERENCES users(id),
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX conversations_recent ON conversations (tenant_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE turns (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  -- Voice と Text は同じ会話（正本 §2 設計原則）。入力様式は属性でしかない。
  modality        text NOT NULL DEFAULT 'text' CHECK (modality IN ('text', 'voice', 'mixed')),
  content         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX turns_by_conversation ON turns (conversation_id, id);

-- migrate:down
DROP TABLE IF EXISTS turns;
DROP TABLE IF EXISTS conversations;
