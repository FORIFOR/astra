# Blind pixel review — RC 6ebeaf3（judge: haiku, opus, sonnet、人手 0）

KEEP 3 / FIX_CANDIDATE 0 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=PASS

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.apps-connectors` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | primary-action-clarity: 接続開始のボタンが無い。4行とも操作対象が空の丸印だけで、押すと何が起きるか（認証が始まるのか、トグルなのか）が絵から読めない; consistency: 同じ未接続状態が「設定が必要」バッジ（上のグループ）と「○ 未接続」（Finder カード）の二通りで表現され、カードの形も幅も違う; primary-action clarity: 「設定が必要」と表示されているのに接続を始めるボタンやトグルスイッチが無く、意味の曖昧な空の丸アイコンしかない; consistency: Finderのコネクタだけ色付きアイコン+独立カードという別スタイルで、 |
| `main.home-work-context` | KEEP | haiku:KEEP opus:FIX× sonnet:KEEP |  |
| `main.home-work-why` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | trust-provenance: 同一カード内で未返信期間が「（3 日）」と「48 時間未返信」の二つ示され、根拠の数字が食い違って見える。出所提示が売りの画面でこれは信頼を損なう; state-legibility: 展開状態を示す表示が無い。右上の「なぜ重要？」は閉じているときと同じ文字のままで、どこを押せば畳めるのか絵から分からない; state legibility: 「なぜ重要？」を展開した後もリンクのラベルが変わらず、現在展開中であることや閉じる方法が示されていない |
