-- World Model。正本 §10、Phase 6 実装仕様 §2。
-- migrate:up

-- 会話ログではなく「ユーザーの世界の現在状態」。
-- Graph DB は入れない（正本 §10.2）。要るまで PostgreSQL で足りる。
CREATE TABLE world_entities (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  kind            text NOT NULL CHECK (kind IN (
    'person','organization','project','conversation','meeting','task','commitment',
    'decision','artifact','research_run','evidence','event','preference','domain_entity'
  )),
  name            text NOT NULL CHECK (name <> ''),
  -- 同じ人を二度作らないための鍵（D-45）
  normalized_name text NOT NULL CHECK (normalized_name <> ''),
  -- 何度出てきたか。「よく出てくる人・案件」の判定に使う（正本 §10.3）
  mention_count   int NOT NULL DEFAULT 1 CHECK (mention_count >= 0),
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);
-- 寄せの一意鍵。同じ種別の同じ正規化名は 1 つ。
CREATE UNIQUE INDEX world_entities_identity
  ON world_entities (tenant_id, kind, normalized_name);
CREATE INDEX world_entities_recent ON world_entities (tenant_id, last_seen_at DESC);

CREATE TABLE world_edges (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  from_id    uuid NOT NULL REFERENCES world_entities(id),
  to_id      uuid NOT NULL REFERENCES world_entities(id),
  -- 正本 §10.1 の 8 種。ここに無い関係は張らない。
  relation   text NOT NULL CHECK (relation IN (
    'belongs_to','works_with','mentioned_in','decided_in',
    'produced_by','assigned_to','depends_on','related_to'
  )),
  weight     numeric(4,3) NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id, relation),
  CONSTRAINT world_edges_not_self CHECK (from_id <> to_id)
);
CREATE INDEX world_edges_reverse ON world_edges (to_id, relation);

-- 覚えていること。**出所を必ず持つ**（D-43）。
-- 辿れないものは信用の根拠にならない。
CREATE TABLE world_facts (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  -- 正本 §10.3 の保存候補。これ以外は書かない。
  kind              text NOT NULL CHECK (kind IN (
    'preference','commitment','decision','artifact_lineage','task_status','correction'
  )),
  statement         text NOT NULL CHECK (statement <> ''),
  subject_entity_id uuid REFERENCES world_entities(id),
  -- 出所。NOT NULL なので、出所なしでは作れない。
  source            jsonb NOT NULL,
  status            text CHECK (status IN ('OPEN','DONE','DROPPED')),
  due_at            timestamptz,
  confidence        numeric(3,2) NOT NULL DEFAULT 1.0
                      CHECK (confidence >= 0 AND confidence <= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- status を持つのは commitment だけ
  CONSTRAINT world_facts_status_only_for_commitment
    CHECK (kind = 'commitment' OR status IS NULL)
);
CREATE INDEX world_facts_open_commitments
  ON world_facts (tenant_id, due_at NULLS LAST)
  WHERE kind = 'commitment' AND status = 'OPEN';
CREATE INDEX world_facts_by_subject ON world_facts (subject_entity_id, kind);
-- 同じ出所から同じ文を二度覚えない
CREATE UNIQUE INDEX world_facts_dedupe
  ON world_facts (tenant_id, kind, md5(statement), md5(source::text));

-- いつ何が起きたか。**書き換えない。**
CREATE TABLE world_events (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  entity_id  uuid REFERENCES world_entities(id),
  kind       text NOT NULL CHECK (kind <> ''),
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX world_events_recent ON world_events (tenant_id, occurred_at DESC);

CREATE TRIGGER world_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON world_events
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

ALTER TABLE world_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY world_entities_tenant_isolation ON world_entities
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE world_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY world_edges_tenant_isolation ON world_edges
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE world_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY world_facts_tenant_isolation ON world_facts
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE world_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_events FORCE ROW LEVEL SECURITY;
CREATE POLICY world_events_tenant_isolation ON world_events
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS world_events;
DROP TABLE IF EXISTS world_facts;
DROP TABLE IF EXISTS world_edges;
DROP TABLE IF EXISTS world_entities;
