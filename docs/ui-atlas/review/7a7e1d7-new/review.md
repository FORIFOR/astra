# Blind pixel review — RC 7a7e1d7（judge: haiku, opus, sonnet、人手 0）

KEEP 5 / FIX_CANDIDATE 2 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.granted` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | trust-provenance: 利用者に見せる一覧に「AstraDbg」という開発版らしき名前が出ており、しかもアイコンが空の灰色四角で、隣の AnyDesk / ChatGPT のような正式な見た目になっていない。どのアプリを許可しているのか信用しづらい。; state legibility: スイッチは既にオンに見えるのに「再起動すると使えます」と出ており、いま許可済みなのか未許可なのかが読み取れない。 |
| `guided-setup.denied` | FIX_CANDIDATE | haiku:FIX× opus:FIX sonnet:FIX | screen-occupation: 右端の丸い常駐ボタンが枠の縁で切り落とされ、円として完結していない。; error-recovery clarity: 「もう一度開く」を押しても同じ失敗が繰り返される場合の逃げ道が示されていない。副文は道順だけで、手動でたどればよいのか自動再試行だけなのかが読み取れない。; primary-action clarity: パンくず『プライバシーとセキュリティ ﹥ 画面収録』がボタンなのか単なる説明文なのか、下線や色などの視覚的な手がかりが無く判別できない。再試行が再び失敗した場合の代替導線が不明瞭。 |
| `screenshot.detected` | FIX_CANDIDATE | haiku:KEEP× opus:FIX sonnet:FIX | primary-action clarity: 「そのまま聞けます」と促しているのに、聞くための手段（入力欄・マイク・ボタン）がこの面のどこにも見えない。次にどう操作すればよいかが絵から分からない。; screen-occupation: 本文右側の広い空白が何にも使われておらず、行動を促す要素が置かれていない。; trust-provenance: 何が認識されたのかを示す画像サムネイルが無いため、ユーザーは実際に何が読み取られたのか視覚的に確認できない。 |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | hierarchy: 見出しが「自動で見つけられません」という内部処理の失敗を語り、実際に必要な行動は副文側にある。利用者にとって一番大事な指示が二番目の行に落ちている。; state legibility: 同系の他のトーストと違い左端にアイコンが無く、これが失敗の知らせなのか単なる案内なのかが一目で判別できない。 |
| `guided-setup.intro` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
