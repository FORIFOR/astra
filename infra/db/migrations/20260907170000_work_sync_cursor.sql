-- migrate:up
-- Work Context の同期位置を**永続**にする（Phase 6、Work Context 仕様「PERSISTENT_SYNC_CURSOR」）。
--
-- 端末の worker は process 内でしか cursor を覚えておらず、再起動のたびに 14 日分を読み直していた
-- （API 呼び出し・端末 LLM の分類・起動直後の負荷が毎回）。ここに置く。
--
-- 順番は fetch → normalize → artifact upsert → cursor commit（同じ transaction）。
-- 先に cursor を書かない。途中で落ちれば同じ範囲をもう一度読み、id の dedupe が最後の安全網。
ALTER TABLE work_sync_state
  -- 一度も成功していない source は「成功した時刻」を持たない（失敗だけが残る）
  ALTER COLUMN last_synced_at DROP NOT NULL,
  ALTER COLUMN last_synced_at DROP DEFAULT,
  ADD COLUMN watermark       timestamptz,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN last_error      text,
  ADD COLUMN schema_version  int NOT NULL DEFAULT 1 CHECK (schema_version >= 1);

COMMENT ON COLUMN work_sync_state.cursor IS '続きの位置（source ごとの形。メールは最後に見た時刻の ISO）。artifact の upsert と同じ transaction でだけ進む';
COMMENT ON COLUMN work_sync_state.watermark IS '取り込んだ artifact の occurred_at の最大。cursor とは別に、どこまで見えているかの事実';
COMMENT ON COLUMN work_sync_state.last_attempt_at IS '最後に試した時刻（失敗も含む）';
COMMENT ON COLUMN work_sync_state.last_synced_at IS '最後に成功した時刻';
COMMENT ON COLUMN work_sync_state.last_error IS '最後の失敗の理由。成功したら消す';
COMMENT ON COLUMN work_sync_state.schema_version IS '正規化の版。上がったら cursor を捨てて読み直す';

-- migrate:down
UPDATE work_sync_state SET last_synced_at = now() WHERE last_synced_at IS NULL;
ALTER TABLE work_sync_state
  ALTER COLUMN last_synced_at SET DEFAULT now(),
  ALTER COLUMN last_synced_at SET NOT NULL,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS last_attempt_at,
  DROP COLUMN IF EXISTS watermark;
