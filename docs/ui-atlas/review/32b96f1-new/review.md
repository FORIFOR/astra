# Blind pixel review — RC 32b96f1（judge: haiku, opus, sonnet、人手 0）

KEEP 6 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | trust-provenance: 権限を渡す相手として並ぶ3つのアプリのうち、AstraDbg だけアイコンが空白のプレースホルダで、名前も内部ビルド風。誰に権限を与えているのか確信が持てない; contrast: ラベルの背景が行の背景とほぼ同じ明度で、輪郭がほとんど立たず、システム画面の一部なのかアプリの吹き出しなのか区別できない; trust-provenance: リストに表示されているアプリ名が『AstraDbg』という内部/デバッグ用らしき名称になっており、AnyDesk・ChatGPT のような正式なアプリ名と並ぶと未完成に見える; state legibility: 青いフォ |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | primary-action clarity: 『システム設定を開く』がボタンではなく丸みを帯びたタグ(ピル内ピル)として表示されており、押せる要素だと認識しにくい; alignment: ×ボタンと右端の丸アイコンの間の余白が不自然に広く、アイコンが通知から浮いて見える |
| `guided-setup.denied` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | primary-action clarity: 再試行操作『もう一度開く』がボタンでなくタグ状ラベルに見え、失敗直後の重要な回復アクションにしては目立たない; error-recovery clarity: エラー理由(なぜ開けなかったか)が示されておらず、再試行以外の代替手段も提示されていない |
| `screenshot.detected` | KEEP | haiku:KEEP× opus:FIX sonnet:KEEP | error-recovery clarity: 取り込みを取り消す・閉じる手段が無い。間違ったスクリーンショットが取り込まれた場合に引き返せない; hierarchy: 一番大きく強い文字が「スクリーンショット」という種類名で、利用者が本当に知りたい状態と次の行動（認識しました・そのまま聞いてください）が薄い小さな文字に落ちている |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.granted` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.intro` | FIX_CANDIDATE | haiku:KEEP× opus:FIX sonnet:FIX | state legibility: 権限が「未許可」という状態を示す語（未許可・オフ・要許可など）やアイコンが一切なく、依頼文だけで現在の状態が明示されていない。エラー由来の通知なのか通常の案内なのか区別がつかない; consistency: 右端の円形アイコンが pill と分離した別の面として置かれ、同じ通知の一部なのか常駐ウィジェットなのか統一が取れていない。ラベルもないため役割不明; state legibility: 右端の紫色の丸いアイコンボタンにラベルやツールチップがなく、押すと何が起きるのか視覚的に説明されていない; primary-action clarity: 「システム設 |
