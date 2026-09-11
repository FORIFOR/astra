# Blind pixel review — RC 3f2c1e9（judge: haiku, opus, sonnet、人手 0）

KEEP 2 / FIX_CANDIDATE 0 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=PASS

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-work-context` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | consistency: 同じ「今日やること」の文脈なのに、上 3 件はカード、下 2 セクションは枠なしの行という別の視覚言語で表現されており、重要度の差なのか種類の差なのか絵から読み取れない; alignment: セクション見出し『今日、気にした方がいいこと』『待っていること』『返すもの』の左端が、その下のカードの本文左端とずれている |
| `main.home-meeting-brief` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | trust-provenance: 本文に『SITE_ID』という未置換のプレースホルダ様の文字列がユーザー向け文章の中に出ており、生成内容の信頼性を損なう; consistency: 同じ MOPITA 定例の時刻が、この画面では『今日 23:19』、A9B6 の最上位カードでは『明日 15:00』と読め、同一製品内で予定の表記が一致していない; trust-provenance: 顧客識別子が未置換のプレースホルダー「SITE_ID」のまま本文に表示されており、実データではなくテンプレート変数が漏れているように見える |
