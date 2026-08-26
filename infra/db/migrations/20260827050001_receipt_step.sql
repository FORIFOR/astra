-- Action Receipt を人が読める形で見せるための紐付け。正本 §9.4、UI/UX §22・§14.1。
--
-- receipt には tool_id と inputs_hash しか無く、
-- 「何をしたのか」を人の言葉で言えるものが入っていなかった。
-- step_index を持てば、その step の承認文面（approvals.summary）と
-- 進捗の文言に辿れる。**表示のために推測しないで済む。**
-- migrate:up

ALTER TABLE action_receipts ADD COLUMN step_index integer;

-- 既存行は step が分からない。埋めずに NULL のままにする
-- （分からないものを、それらしい値で埋めない）。
COMMENT ON COLUMN action_receipts.step_index IS
  '受け取り元の step。古い行は NULL（後から復元できないため埋めていない）。';

-- Work detail は「この仕事の receipt を新しい順に」を引く
CREATE INDEX action_receipts_task_executed_idx
  ON action_receipts (tenant_id, task_id, executed_at DESC);

-- migrate:down
DROP INDEX action_receipts_task_executed_idx;
ALTER TABLE action_receipts DROP COLUMN step_index;
