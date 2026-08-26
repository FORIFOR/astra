-- Agent Package の実行と domain schema。Phase 5 実装仕様 §2・§3。
-- migrate:up

-- 計画は **task を作る時点で確定させる**（D-40）。
-- workflow のコードは決定的でなければならないので、DB を読ませない。
-- install した plugin の agent は固定リストに入らないため、これが要る。
ALTER TABLE tasks ADD COLUMN plan jsonb;

-- plugin が持ち込む entity。**plugin ごとに DDL を走らせない**（D-41）。
-- migration をユーザ入力にすると、そこが最大の攻撃面になる。
CREATE TABLE domain_entities (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  -- どの plugin の、どの entity 型か
  plugin_id   text NOT NULL REFERENCES plugins(id),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]*$'),
  -- 表示名。一覧で人が読む
  title       text NOT NULL CHECK (title <> ''),
  -- 定義に照らして検証済みの値だけが入る
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 何から生まれたか（会議・調査・task）。lineage を切らさない
  source_task_id    uuid REFERENCES tasks(id),
  source_meeting_id uuid REFERENCES meetings(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domain_entities_by_type ON domain_entities (tenant_id, plugin_id, entity_type, id DESC);
-- 集計（pipeline analysis）で使う
CREATE INDEX domain_entities_fields ON domain_entities USING gin (fields);

-- entity どうしの関係。商談 → 活動 のような紐づけ。
CREATE TABLE domain_links (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  from_id     uuid NOT NULL REFERENCES domain_entities(id),
  to_id       uuid NOT NULL REFERENCES domain_entities(id),
  relation    text NOT NULL CHECK (relation ~ '^[a-z][a-z0-9_]*$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id, relation),
  -- 自分自身へは張らない
  CONSTRAINT domain_links_not_self CHECK (from_id <> to_id)
);
CREATE INDEX domain_links_reverse ON domain_links (to_id, relation);

ALTER TABLE domain_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_entities_tenant_isolation ON domain_entities
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE domain_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_links FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_links_tenant_isolation ON domain_links
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS domain_links;
DROP TABLE IF EXISTS domain_entities;
ALTER TABLE tasks DROP COLUMN IF EXISTS plan;
