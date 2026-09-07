# Blind pixel review — RC 1127b32（judge: haiku, opus, sonnet、人手 0）

KEEP 1 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-work-context` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `main.home-personalization` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX | state legibility: 複数の選択肢ボタンが存在する場合、現在有効な状態が視覚的に明確でない。『推測を使っています』はステータステキストに見えるが、実際の UI トグルとの関係が不明確。; primary-action clarity: 各設定項目に複数の選択肢がある場合、どちらが推奨/デフォルト選択肢なのか、どちらが現在の設定なのかが視覚的に区別されていない。ボタンの色、太さ、背景の違いが見当たらない。; state legibility: 「確認済み」の項目で「そのとおり」が濃い塗りボタン、未確認の項目では薄いボタンになっており、済んでいる方が強く押せそうに見えて状態と強調が逆 |
