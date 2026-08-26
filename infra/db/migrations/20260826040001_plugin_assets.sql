-- manifest が宣言したファイルの実体。Phase 4 実装仕様 §2。
-- migrate:up

-- 宣言と実体がずれた plugin は「install だけで増える」を壊す（D-31）。
-- 実体をここに持ち、publish のときに全部あることを確かめる。
CREATE TABLE plugin_assets (
  plugin_id   text NOT NULL REFERENCES plugins(id),
  version     text NOT NULL,
  -- manifest 内の相対パス（`dashboards/pipeline.json` など）
  path        text NOT NULL CHECK (path <> '' AND path !~ '\.\.'),
  kind        text NOT NULL CHECK (kind IN ('skill','dashboard','policy','data_extension')),
  content     bytea NOT NULL,
  sha256      char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, version, path),
  FOREIGN KEY (plugin_id, version) REFERENCES plugin_versions(plugin_id, version)
);
CREATE INDEX plugin_assets_by_kind ON plugin_assets (plugin_id, version, kind);

-- 公開した版の中身は変わらない。版が違えば別の行。
CREATE TRIGGER plugin_assets_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON plugin_assets
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

-- 前の版。rollback が戻る先（AC4-10）。
-- 監査ログから引かない。監査は「起きたことの記録」であって、状態ではない。
ALTER TABLE plugin_installs ADD COLUMN previous_version text;

-- migrate:down
ALTER TABLE plugin_installs DROP COLUMN IF EXISTS previous_version;
DROP TABLE IF EXISTS plugin_assets;
