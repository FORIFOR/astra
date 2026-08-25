-- テナント / ユーザー / デバイス / セッション。実装仕様 §4・§5.3。
-- migrate:up

CREATE TABLE tenants (
  id                 uuid PRIMARY KEY,
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('personal', 'organization')),
  compliance_profile text NOT NULL DEFAULT 'GENERAL'
                     CHECK (compliance_profile IN
                       ('GENERAL','ENTERPRISE','REGULATED_HEALTH','CARE','FINANCIAL')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE TABLE users (
  id           uuid PRIMARY KEY,
  email        citext NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE deleted_at IS NULL;

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE devices (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  platform     text NOT NULL CHECK (platform IN ('macos','windows','linux','web')),
  name         text NOT NULL,
  app_version  text NOT NULL,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_by_user ON devices (tenant_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  device_id          uuid NOT NULL REFERENCES devices(id),
  -- Argon2id ハッシュ。平文の refresh token は保存しない（実装仕様 §4.2）
  refresh_token_hash text NOT NULL,
  rotated_from       uuid REFERENCES sessions(id),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active ON sessions (tenant_id, user_id) WHERE revoked_at IS NULL;
-- ローテーション時の再利用検知: 同じ親から 2 本目が生えたら異常
CREATE UNIQUE INDEX sessions_rotation_chain ON sessions (rotated_from) WHERE rotated_from IS NOT NULL;

-- migrate:down
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
