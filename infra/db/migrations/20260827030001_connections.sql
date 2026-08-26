-- Connector の接続状態。正本 §2.4・§21。
-- migrate:up

-- **資格情報そのものは入れない**（正本 §21）。
-- ここに入るのは「どこに置いたか」の参照だけ。
-- 平文のトークンをアプリの DB に置くと、DB を読める全員が読める。
CREATE TABLE connector_connections (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  plugin_id      text NOT NULL REFERENCES plugins(id),
  -- manifest の connectors[].id
  connector_id   text NOT NULL CHECK (connector_id ~ '^[a-z][a-z0-9_-]*$'),
  provider       text NOT NULL CHECK (provider <> ''),
  state          text NOT NULL CHECK (state IN ('CONNECTED','EXPIRED','REVOKED','ERROR')),
  -- 実際に許可された scope。要求した scope ではない。
  granted_scopes text[] NOT NULL DEFAULT '{}',
  -- 保管庫の参照。**値ではない。**`keychain:astra/gmail/<id>` のような形。
  credential_ref text CHECK (credential_ref IS NULL OR credential_ref <> ''),
  -- 誰の名前で繋いだか。表示に使う。アドレスそのものは持たない。
  account_label  text,
  connected_by   uuid NOT NULL REFERENCES users(id),
  connected_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  last_error     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- 繋がっているなら、参照が要る
  CONSTRAINT connector_connections_connected_needs_ref
    CHECK (state <> 'CONNECTED' OR credential_ref IS NOT NULL),
  -- 失効しているなら、いつ失効したかが要る
  CONSTRAINT connector_connections_revoked_needs_time
    CHECK (state <> 'REVOKED' OR revoked_at IS NOT NULL)
);
-- 同じ connector を二重に繋がない
CREATE UNIQUE INDEX connector_connections_unique
  ON connector_connections (tenant_id, plugin_id, connector_id)
  WHERE state <> 'REVOKED';
CREATE INDEX connector_connections_by_tenant ON connector_connections (tenant_id, plugin_id);

ALTER TABLE connector_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_connections_tenant_isolation ON connector_connections
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS connector_connections;
