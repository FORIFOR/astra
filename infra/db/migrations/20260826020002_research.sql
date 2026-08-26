-- Research と Evidence Ledger。正本 §8。
-- migrate:up

CREATE TABLE research_runs (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  task_id       uuid NOT NULL REFERENCES tasks(id),
  question      text NOT NULL,
  -- 質問を分解した下位クエリ。何を調べたかを後から説明できるようにする。
  sub_queries   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL CHECK (status IN ('PLANNING','SEARCHING','SYNTHESIZING','COMPLETE','FAILED')),
  source_count  int NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  -- 結論の確信度。source の質と矛盾の有無から算出する。
  confidence    text CHECK (confidence IN ('low','medium','high')),
  report_artifact_id uuid REFERENCES artifacts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX research_runs_task ON research_runs (task_id);
CREATE INDEX research_runs_recent ON research_runs (tenant_id, id DESC);

-- 正本 §8.2 Evidence Ledger。「この結論の根拠は？」に後から答えるための台帳。
CREATE TABLE evidence (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  research_run_id uuid NOT NULL REFERENCES research_runs(id),
  source_url      text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('official','filing','news','internal','other')),
  publisher       text,
  published_at    timestamptz,
  retrieved_at    timestamptz NOT NULL DEFAULT now(),
  claim           text NOT NULL,
  -- 原文の該当箇所への参照。全文は object store 側に置く。
  support_text_ref text,
  quality_score   numeric(3,2) NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  freshness_score numeric(3,2) NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
  -- 同じ主張を支持する / 矛盾する evidence の id
  supports        uuid[] NOT NULL DEFAULT '{}',
  contradicts     uuid[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_by_run ON evidence (research_run_id, quality_score DESC);
-- 同じ run で同じ URL の同じ主張を二重に積まない
CREATE UNIQUE INDEX evidence_dedupe ON evidence (research_run_id, source_url, md5(claim));

-- Evidence は根拠なので後から書き換えない
CREATE TRIGGER evidence_append_only
  BEFORE DELETE OR TRUNCATE ON evidence
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY research_runs_tenant_isolation ON research_runs
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_tenant_isolation ON evidence
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS evidence;
DROP TABLE IF EXISTS research_runs;
