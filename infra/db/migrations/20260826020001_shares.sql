-- 共有リンク。正本 §2.3、Phase 2 実装仕様 §2。
-- migrate:up

CREATE TABLE shares (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  artifact_id        uuid NOT NULL REFERENCES artifacts(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  -- 256bit 乱数のハッシュ。平文のトークンは発行時の一度きり。
  token_hash         char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- 利用者が選ぶ低エントロピーの秘密なので Argon2id。null ならパスワードなし。
  password_hash      text,
  allow_download     boolean NOT NULL DEFAULT false,
  one_time           boolean NOT NULL DEFAULT false,
  watermark          boolean NOT NULL DEFAULT false,
  allowlist          text[] NOT NULL DEFAULT '{}',
  -- 無期限の共有を作らせない（NOT NULL）
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  consumed_at        timestamptz,
  access_count       int NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- 一回限りでない共有が「使い切り」になることはない
  CONSTRAINT shares_consumed_only_when_one_time CHECK (one_time OR consumed_at IS NULL)
);

-- 公開 viewer は tokenId で引く。テナントを知らないので id が一次キーになる。
CREATE UNIQUE INDEX shares_token ON shares (token_hash);
CREATE INDEX shares_by_artifact ON shares (tenant_id, artifact_id) WHERE revoked_at IS NULL;
CREATE INDEX shares_expiring ON shares (expires_at) WHERE revoked_at IS NULL;

-- 正本 §2.3「access audit」。append-only。
CREATE TABLE share_access_logs (
  id             uuid PRIMARY KEY,
  share_id       uuid NOT NULL REFERENCES shares(id),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  outcome        text NOT NULL CHECK (outcome IN ('granted', 'denied')),
  -- 拒否の理由は監査のためだけに残す。クライアントへは返さない。
  reason         text,
  -- 生の IP は残さない（正本 §21）。粗い識別のためのハッシュだけ。
  requester_hash char(64) CHECK (requester_hash ~ '^[0-9a-f]{64}$'),
  accessed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_access_logs_by_share ON share_access_logs (share_id, accessed_at DESC);

CREATE TRIGGER share_access_logs_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON share_access_logs
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

-- RLS。公開 viewer は system スコープでトークンから引くので、
-- テナント側の見え方だけをここで縛る。
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares FORCE ROW LEVEL SECURITY;
CREATE POLICY shares_tenant_isolation ON shares
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE share_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_access_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY share_access_logs_tenant_isolation ON share_access_logs
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE IF EXISTS share_access_logs;
DROP TABLE IF EXISTS shares;
