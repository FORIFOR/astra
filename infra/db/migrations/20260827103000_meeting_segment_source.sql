-- 会議の segment に「どの音源から来たか」を持たせる。正本 §11.3・§12.2。
--
-- **出所が一次情報で、話者分離は二次情報。**利用者の決定でそうなっている。
-- ところが segment の表には話者番号しか無く、出所は保存の時点で消えていた。
-- 起こす側は出所を出しているのに、置く場所が無かった。
--
-- 消えると何が起きるか: mic（自分）と system（相手）の区別が、
-- 分離の番号だけに戻る。分離が落ちた録音では誰の発言か分からなくなり、
-- 分離が効いていても「Speaker 1 は自分か相手か」を答えられない。
-- migrate:up

ALTER TABLE meeting_segments
  ADD COLUMN source text
  CONSTRAINT meeting_segments_source_check
  CHECK (source IS NULL OR source IN ('microphone', 'system', 'mixed'));

COMMENT ON COLUMN meeting_segments.source IS
  '一次情報。microphone=自分 / system=相手 / mixed=分けられない。不明なら NULL（推測で埋めない）';

-- 出所で引けるようにする。「相手の発言だけ」を見る操作は普通に起きる。
CREATE INDEX meeting_segments_by_source
  ON meeting_segments (tenant_id, meeting_id, source)
  WHERE source IS NOT NULL;

-- migrate:down
DROP INDEX meeting_segments_by_source;
ALTER TABLE meeting_segments DROP COLUMN source;
