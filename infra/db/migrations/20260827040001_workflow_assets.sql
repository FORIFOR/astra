-- Agent Package の Workflows / Evaluations。正本 §14。
-- migrate:up

-- 種別を足す。CHECK を直すのは、宣言できるものが増えたから。
ALTER TABLE plugin_assets DROP CONSTRAINT plugin_assets_kind_check;
ALTER TABLE plugin_assets ADD CONSTRAINT plugin_assets_kind_check
  CHECK (kind IN ('skill','dashboard','policy','data_extension','workflow','evaluation'));

-- migrate:down
ALTER TABLE plugin_assets DROP CONSTRAINT plugin_assets_kind_check;
ALTER TABLE plugin_assets ADD CONSTRAINT plugin_assets_kind_check
  CHECK (kind IN ('skill','dashboard','policy','data_extension'));
