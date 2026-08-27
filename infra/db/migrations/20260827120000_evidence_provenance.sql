-- 根拠が「どこから来たか」を残す。正本 §8、UI/UX §15。
--
-- いままで残していたのは URL・出典種別・発行者・取得時刻・主張だけ。
-- **その頁が何と書いてあったか（title / snippet）も、
-- どの検索で見つけたか（provider）も残していなかった。**
--
-- 何が困るか:
--   - 台帳を見た人が、URL を開き直さないと文脈が分からない。
--     リンク切れなら、もう確かめられない
--   - 検索の提供者を替えたとき、**どの結果が古い提供者のものか**が
--     分からない。質の比較も、片方だけの取り消しもできない
-- migrate:up

ALTER TABLE evidence
  -- 見つけたときの見出しと抜粋。**あとから取り直さなくても読める**ように。
  ADD COLUMN title text,
  ADD COLUMN snippet text,
  -- どの検索が見つけたか。空文字は「分からない」と紛れるので禁じる。
  ADD COLUMN provider text CHECK (provider IS NULL OR provider <> '');

COMMENT ON COLUMN evidence.snippet IS
  '見つけた時点の抜粋。support_text の一致検査はこれに対して行う';
COMMENT ON COLUMN evidence.provider IS
  'この根拠を見つけた検索の名前。提供者を替えたとき、どれが古いかを見分ける';

-- 提供者ごとに引けるようにする。「あの検索の結果だけ捨てる」が要る。
CREATE INDEX evidence_by_provider
  ON evidence (tenant_id, provider)
  WHERE provider IS NOT NULL;

-- migrate:down
DROP INDEX evidence_by_provider;
ALTER TABLE evidence DROP COLUMN provider, DROP COLUMN snippet, DROP COLUMN title;
