-- 1 つの step から、端末へ何度も頼めるようにする。正本 §4.4・§16.1。
--
-- 受け渡しは「step ごとに 1 件」で作った。connector はそれで足りる
-- （1 step = 1 送信）。だが言語モデルは 1 step の中で何度も呼ぶ
-- （分解 → 抽出 → 統合）。step だけを鍵にすると、2 回目が
-- **1 回目の結果を返してしまう。**分解の答えが統合の答えとして返る。
--
-- そこで呼び出し側が鍵を添える。connector は空のまま（step ごとに 1 件）、
-- 言語モデルは呼び出しの内容から鍵を作る。同じ内容なら結果を使い回し、
-- 違う内容なら別の依頼になる。
-- migrate:up

ALTER TABLE host_step_requests
  ADD COLUMN request_key text NOT NULL DEFAULT '';

DROP INDEX host_step_requests_step;
CREATE UNIQUE INDEX host_step_requests_step
  ON host_step_requests (task_id, step_index, request_key);

-- migrate:down
DROP INDEX host_step_requests_step;
CREATE UNIQUE INDEX host_step_requests_step ON host_step_requests (task_id, step_index);
ALTER TABLE host_step_requests DROP COLUMN request_key;
