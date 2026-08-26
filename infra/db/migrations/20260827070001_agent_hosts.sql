-- 手元の実行基盤。正本 §4.4・§16.1。
--
-- Dock は UI、Local Agent Host は実行基盤。Dock を閉じても仕事は続く。
-- 端末が落ちたら **FAILED ではなく PAUSED_HOST_OFFLINE**。待てば戻る。
-- migrate:up

-- 端末が落ちた仕事の状態。**FAILED とは別に持つ。**
-- 型（TypeScript）だけ増やしても、DB が受け取らなければ入らない。
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'PENDING','RUNNING','WAITING_APPROVAL','PAUSED_HOST_OFFLINE',
    'CANCELLING','COMPLETED','FAILED','CANCELLED'
  ));

CREATE TABLE agent_hosts (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  -- 同じ端末で入れ直しても同じ id になるよう、端末側が決める安定な名前
  device_label  text NOT NULL CHECK (device_label <> ''),
  -- この端末で使えるモデル。空なら仕事を渡さない
  models        text[] NOT NULL DEFAULT '{}',
  capabilities  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 最後に応答があった時刻。**これだけで online を判断する**
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 同じ端末を二重に登録しない
CREATE UNIQUE INDEX agent_hosts_device ON agent_hosts (tenant_id, user_id, device_label);
CREATE INDEX agent_hosts_alive ON agent_hosts (tenant_id, last_seen_at DESC);

-- 仕事の貸し出し。
--
-- **同じ仕事を二重に走らせない**ための唯一の仕組み。
-- Dock と Host、再接続後の Host が同時に動くと、外部への操作が二度起きる。
CREATE TABLE job_leases (
  task_id     uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  host_id     uuid NOT NULL REFERENCES agent_hosts(id) ON DELETE CASCADE,
  -- 貸し出しごとに変わる。古い lease を持った host の書き込みを弾く
  lease_id    uuid NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- 何回目の挑戦か。無限に取り直していないかを見る
  attempt     int NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_leases_host ON job_leases (host_id);
CREATE INDEX job_leases_expiry ON job_leases (tenant_id, expires_at);

-- 長い仕事の途中経過。
--
-- PC が寝ても最初からやり直さないため。**上書きしていく**（履歴は要らない）。
CREATE TABLE job_checkpoints (
  task_id     uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  -- どこまで進んだか。中身は仕事の種類ごとに決める
  state       jsonb NOT NULL DEFAULT '{}'::jsonb,
  step_index  int NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_hosts FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_hosts_tenant_isolation ON agent_hosts
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE job_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY job_leases_tenant_isolation ON job_leases
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE job_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY job_checkpoints_tenant_isolation ON job_checkpoints
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'PENDING','RUNNING','WAITING_APPROVAL',
    'CANCELLING','COMPLETED','FAILED','CANCELLED'
  ));
DROP TABLE job_checkpoints;
DROP TABLE job_leases;
DROP TABLE agent_hosts;
