# Blind pixel review — RC 6605c95（judge: haiku, opus, sonnet、人手 0）

KEEP 3 / FIX_CANDIDATE 0 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=PASS

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-work-context` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | primary-action-clarity: 同一行内の2つのテキストリンク（なぜ重要?／優先ではない）が同色・同ウェイトで、優先すべき操作が視覚的に区別できない |
| `main.home-work-why` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | primary-action-clarity: 3A2Dと同様、「閉じる」と「優先ではない」が同色同ウェイトのリンクで並び、主アクションが区別されない |
| `main.apps-connectors` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | error-recovery clarity: 4 件すべてが「設定が必要」なのに、そこから復旧する手段が画面上に無い。文言は内部の環境変数名（ASTRA_OAUTH_GOOGLE_CLIENT_ID / ASTRA_OAUTH_MICROSOFT_CLIENT_ID）だけで、利用者が次に何をするかが書かれていない; primary-action clarity: この画面の主目的は「つなぐ」ことのはずだが、押せると分かる要素が無い。行頭の空の丸がボタンなのか状態表示なのか絵から判別できない; error-recovery clarity: 「設定が必要」と表示されるだけで、それを解消するため |
