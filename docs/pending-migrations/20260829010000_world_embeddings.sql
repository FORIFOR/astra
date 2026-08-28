-- World Model の意味検索。正本 §10.2「PostgreSQL + JSONB + relation edge table + pgvector で実装する」
-- が挙げる 5 表のうち world_embeddings が欠けていたので足す。Graph DB は入れない（§10.2）。
-- migrate:up

-- pgvector。無ければ有効化する（Cloud SQL / postgres:16 の contrib に含まれる）。
CREATE EXTENSION IF NOT EXISTS vector;

-- entity ごとの埋め込み。retrieval は「今の世界の状態」を引くため（§10.1）で、
-- 会話ログ全文の検索ではない。同じ entity を複数モデルで持てるよう model を鍵に含める。
CREATE TABLE world_embeddings (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  entity_id   uuid NOT NULL REFERENCES world_entities(id) ON DELETE CASCADE,
  -- どのモデルで埋めたか。次元が違う埋め込みを混ぜて比較しないための鍵。
  model       text NOT NULL CHECK (model <> ''),
  dim         int NOT NULL CHECK (dim > 0),
  -- 埋め込み本体。次元はモデル依存なので型では固定せず dim で持つ。
  embedding   vector NOT NULL,
  -- 何を埋めたか（name / attributes の要約など）。空文字は入れない。
  source_text text NOT NULL CHECK (source_text <> ''),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 同じ entity × 同じモデルの埋め込みは 1 本（作り直しは UPDATE）。
CREATE UNIQUE INDEX world_embeddings_identity
  ON world_embeddings (tenant_id, entity_id, model);
CREATE INDEX world_embeddings_entity ON world_embeddings (tenant_id, entity_id);

ALTER TABLE world_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY world_embeddings_tenant_isolation ON world_embeddings
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS world_embeddings;
