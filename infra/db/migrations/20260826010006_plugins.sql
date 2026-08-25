-- Plugin registry。実装仕様 §5.3・§9。
-- カタログ（publishers / plugins / plugin_versions）はテナント横断のグローバル資源で、
-- install / permissions のみテナント固有。RLS の対象が分かれる点に注意（0008 参照）。
-- migrate:up

CREATE TABLE plugin_publishers (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  display_name text NOT NULL,
  public_key   text NOT NULL,               -- Ed25519 公開鍵 (base64)
  verified     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugins (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(\.[a-z0-9-]+)+$'),
  publisher_id   text NOT NULL REFERENCES plugin_publishers(id),
  name           text NOT NULL,
  category       text NOT NULL CHECK (category IN
                   ('connector','capability','domain-agent','skill-pack','dashboard-extension')),
  builtin        boolean NOT NULL DEFAULT false,
  removable      boolean NOT NULL DEFAULT true,
  latest_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_versions (
  plugin_id          text NOT NULL REFERENCES plugins(id),
  version            text NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  min_core_version   text NOT NULL CHECK (min_core_version ~ '^\d+\.\d+\.\d+$'),
  compliance_profile text NOT NULL CHECK (compliance_profile IN
                       ('GENERAL','ENTERPRISE','REGULATED_HEALTH','CARE','FINANCIAL')),
  -- 検証済み正規化 manifest。署名対象なので一字も変えずに保持する
  manifest           jsonb NOT NULL,
  manifest_sha256    char(64) NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  signature          text,
  signature_state    text NOT NULL CHECK (signature_state IN
                       ('VERIFIED','BUILTIN_TRUSTED','UNSIGNED')),
  published_at       timestamptz NOT NULL DEFAULT now(),
  yanked_at          timestamptz,
  PRIMARY KEY (plugin_id, version),
  -- 実装仕様 §9.2: UNSIGNED は登録を拒否する
  CONSTRAINT plugin_versions_signed CHECK (signature_state <> 'UNSIGNED')
);

CREATE TABLE plugin_installs (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  plugin_id    text NOT NULL REFERENCES plugins(id),
  version      text NOT NULL,
  installed_by uuid NOT NULL REFERENCES users(id),
  state        text NOT NULL CHECK (state IN ('INSTALLED','DISABLED','UNINSTALLED')),
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plugin_id, version) REFERENCES plugin_versions (plugin_id, version)
);
CREATE UNIQUE INDEX plugin_installs_unique ON plugin_installs (tenant_id, plugin_id)
  WHERE state <> 'UNINSTALLED';

CREATE TABLE plugin_permissions (
  install_id uuid NOT NULL REFERENCES plugin_installs(id),
  scope      text NOT NULL,
  -- tenant_id は RLS を一様に効かせるために持つ（install_id 経由の副問い合わせを避ける）
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  granted    boolean NOT NULL,
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (install_id, scope)
);
CREATE INDEX plugin_permissions_granted ON plugin_permissions (tenant_id, scope) WHERE granted;

-- migrate:down
DROP TABLE IF EXISTS plugin_permissions;
DROP TABLE IF EXISTS plugin_installs;
DROP TABLE IF EXISTS plugin_versions;
DROP TABLE IF EXISTS plugins;
DROP TABLE IF EXISTS plugin_publishers;
