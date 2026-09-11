# Blind pixel review — RC b6575a6（judge: haiku, opus, sonnet、人手 0）

KEEP 6 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | trust-provenance: システム設定風のリスト上に、出所の分からない吹き出しが重なっている。OS の表示なのかサードパーティアプリのオーバーレイなのか判別できず、許可画面という敏感な文脈では信頼性の判断ができない; alignment: 吹き出しが行の内容領域に覆いかぶさり、リスト行の左ラベル／右トグルという整った構造を分断している。他の 2 行と同じ読み方ができない; state legibility: トグルはONに見えるが「再起動すると使えます」という文言と矛盾し、現在有効なのか無効なのか判断できない; alignment: 吹き出しがトグルに重なって配置され、行の右端で要素 |
| `guided-setup.intro` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.granted` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | trust-provenance: 外部サービスへの送信条件を告げているのに、実際に何が送られるのか（プレビュー画像の中身）が見えず、送信を拒む手段も無い。同意に関わる情報なのに、確認も撤回もできない; contrast: 送信条件という最も重要な一文が、暗い背景の上で薄いグレーの細字になっており、見出しより弱く扱われている。読み落としやすい |
| `screenshot.detected` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | primary-action clarity: 「そのまま聞けます」と次の行動を促しているのに、その行動を起こす場所（入力欄・ボタン）がカード内に一切無く、×だけが押せる。促しと操作が噛み合っていない; contrast: 唯一の状態情報が薄いグレーの細字で、暗い背景上で見出しに対して明らかに弱い。成功状態の読み取りが弱くなる |
| `guided-setup.denied` | KEEP | haiku:FIX× opus:KEEP sonnet:KEEP |  |
| `guided-setup.target-missing` | FIX_CANDIDATE | haiku:FIX× opus:FIX sonnet:FIX | primary-action clarity: ラベルのない丸い波形アイコンが主要CTA「システム設定を開く」のすぐ右に同じ視覚的重みで置かれ、どちらが次の行動か迷う。役割が絵から読み取れない; state legibility: エラー状態であることを示す色や記号（警告アイコン等）が一切なく、太字の見出しだけでは通常の案内と区別しにくい; screen occupation: 通知テキスト・ボタン群と、右端の無ラベル円形アイコンとの間に説明のつかない大きな空白があり、視覚的に浮いた要素になっている; consistency: 円形アイコンが何のUI要素か(別の通知/ステータスインジケーター/ |
