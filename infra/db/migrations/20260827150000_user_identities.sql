-- 外部の身元提供者（Google / Apple / LINE）と users の対応。実装仕様 §4.3。
-- migrate:up

CREATE TABLE user_identities (
  provider   text NOT NULL CHECK (provider IN ('google', 'apple', 'line')),
  -- 提供者側の主体 ID（`sub`）。メールは変わり得るが sub は変わらない
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id),
  -- 提供者が確認済みとして返したメール。無い提供者（LINE）は NULL
  email      citext,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identities_by_user ON user_identities (user_id);

-- migrate:down
DROP TABLE IF EXISTS user_identities;
