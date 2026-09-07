# Blind pixel review — RC b7eafe2（judge: haiku, opus, sonnet、人手 0）

KEEP 3 / FIX_CANDIDATE 0 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=PASS

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-work-why` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | primary-action clarity: 最重要カードを開いても実行できる操作が「閉じる」「優先ではない」という却下系だけで、返信・メールを開くなど前進する主要アクションが画面上に無い。出所の Gmail 行が押せるかも見た目で判別できない; consistency: 同じ位置の操作ラベルがカードごとに「閉じる」/「なぜ重要？」と入れ替わるため、列として読めず走査しづらい |
| `main.home-meeting-brief` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | hierarchy: 4つの内容区分(前回/その後/開いている件/今日確認したいこと)がすべて同一の小さい灰色キャプションで、視覚的な軽重差がない; density: 各箇条書きの末尾に小さな「出所N」リンクが余白なく連続配置され、行間も狭いため文字が詰まって見える |
| `main.home-work-context` | KEEP | haiku:KEEP× opus:FIX sonnet:- | consistency: 上段のカードと下段のリスト行で、同じ「未処理の用件」を扱うのに容器（枠あり箱／枠なし行）も操作語彙（優先ではない／外す／済んだ）も異なり、一つの画面として読み方を切り替えさせられる; density: 上の3カードは1件あたり4行＋余白をとるのに、下のリストは1件1行に圧縮されており、重要度の差以上に情報密度が急変して視線のリズムが途切れる |
