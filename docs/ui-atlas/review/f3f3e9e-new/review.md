# Blind pixel review — RC f3f3e9e（judge: haiku, opus, sonnet、人手 0）

KEEP 7 / FIX_CANDIDATE 0 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=PASS

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | alignment: 案内 pill がシステム設定のリスト行の上に重なり、どの行に対する案内かが視覚的に確定しない（AstraDbg 行とも ChatGPT 行とも取れる位置にある）; trust-provenance: 利用者に見える名前が「AstraDbg」という内部ビルド名らしき表記で、製品名として不自然。権限を渡す相手の正体が読み取りにくい; error-recovery clarity: 再起動が必要と伝えているのに、その場で再起動する手段（ボタン等）が提供されていない; consistency: 他の画像（99F9）ではシステム設定を開くボタン付きで誘導しているのに、ここでは同種 |
| `guided-setup.denied` | KEEP | haiku:FIX× opus:KEEP sonnet:FIX | error-recovery clarity: 「開けませんでした」とだけ表示し、原因や再試行が成功する見込みの手がかりが無い; alignment: 警告アイコンの円がテキストピルから浮いて離れており、一体の要素として見えない |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP× opus:KEEP sonnet:KEEP |  |
| `guided-setup.granted` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.intro` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | state legibility: Menu icon (≡) appears without explanation of its function; trust-provenance: 画面収録の権限警告なのに、表示されているアイコンが波形/バーのような無関係な図柄に見え、何を表すアイコンか読み取れない |
| `screenshot.detected` | KEEP | haiku:FIX× opus:KEEP sonnet:FIX | consistency: 同じ『スクリーンショット』タイトルを持つ600Bのピルには閉じるボタンがあるのに、この画像には無く操作の一貫性がない; state legibility: 『認識しました・そのまま聞いてください』という進行中の状態を示すメッセージなのに、状態を示す視覚的インジケーター（アイコン等）が一切無い |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | error-recovery clarity: 1行目「Astra の行が見つかりません」と2行目「設定画面で Astra をオンにしてください」が矛盾している。行が見つからないなら、その行をオンにする操作はできない。利用者は設定画面で何を探せばよいか判断できない; state legibility: 「行」という内部用語が使われており、どの一覧のどの行なのかが画面上に示されていない。ボタンを押した先で何を見ればよいかが分からない; state legibility: エラー状態であるにもかかわらず色やアイコンによる警告表現がなく、通常の通知と区別がつきにくい; consistency: 右端 |
