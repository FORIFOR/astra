-- 手元でしか動かせない step の受け渡し。正本 §4.4・§16.1・§21。
--
-- なぜ要るか: connector の資格情報は**端末の Keychain にしか無い**。
-- cloud の worker はトークンを持たないので、Gmail も Calendar も呼べない。
-- 呼べないものを呼べるふりで実装すると、いずれ「サーバにも置こう」になる。
--
-- だから cloud は「これをやってほしい」と置くだけにし、端末が取りに来て、
-- 端末で実行し、**結果だけ**を返す。トークンは一度もこの表を通らない。
-- migrate:up

CREATE TABLE host_step_requests (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_index    int NOT NULL CHECK (step_index >= 0),
  tool_id       text NOT NULL CHECK (tool_id <> ''),
  -- 実行に要る引数。**資格情報は入れない**（下の制約で見張る）
  args          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 人が承認した跡。**送信や削除は、これが無ければ端末側でも実行されない。**
  -- 承認は cloud で取るが、跡を持たせて端末にも確かめさせる。
  -- 経路が 1 本だと、いつか誰かが「この呼び出しだけ直接」を作る。
  approval      jsonb,
  status        text NOT NULL CHECK (status IN ('PENDING','CLAIMED','DONE','FAILED')),
  -- 取りに来た端末。PENDING の間は null
  host_id       uuid REFERENCES agent_hosts(id) ON DELETE SET NULL,
  result        jsonb,
  -- 失敗の理由。**握り潰さずに残す**。画面に出せる言葉で入れる
  error         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  completed_at  timestamptz,
  -- 取りに来ないまま古くなったものを、いつまでも PENDING で残さない
  expires_at    timestamptz NOT NULL,

  -- 終わったものは、結果か理由のどちらかを必ず持つ。
  -- 「DONE なのに何も無い」を DB の側で作れなくしておく。
  CONSTRAINT host_step_requests_settled CHECK (
    (status = 'DONE'   AND result IS NOT NULL AND completed_at IS NOT NULL) OR
    (status = 'FAILED' AND error  IS NOT NULL AND completed_at IS NOT NULL) OR
    (status IN ('PENDING','CLAIMED') AND completed_at IS NULL)
  ),
  -- CLAIMED 以降は、誰が取ったかが必ず分かる
  CONSTRAINT host_step_requests_claimed CHECK (
    status = 'PENDING' OR (host_id IS NOT NULL AND claimed_at IS NOT NULL)
  )
);

-- 同じ step を二重に置かない。**二重実行の入口を塞ぐ。**
CREATE UNIQUE INDEX host_step_requests_step ON host_step_requests (task_id, step_index);
-- 端末が「次の 1 件」を取るための索引
CREATE INDEX host_step_requests_queue
  ON host_step_requests (tenant_id, status, created_at)
  WHERE status = 'PENDING';

ALTER TABLE host_step_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE host_step_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY host_step_requests_tenant_isolation ON host_step_requests
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE host_step_requests;
