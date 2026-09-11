# Blind pixel review — RC 1039989（judge: haiku, opus, sonnet、人手 0）

KEEP 5 / FIX_CANDIDATE 2 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.intro` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | state legibility: 権限未許可という重要度の高い状態を伝える通知に警告アイコンが無く、同種の他通知(31D7)には⚠が付いていて重大度の伝え方が一貫していない |
| `guided-setup.denied` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | screen occupation / alignment: 右端の丸い部品が枠に対して収まりきらず、円の右側が切れている。失敗を伝える画面で部品が欠けていると、表示自体が壊れているように見えて信頼を損なう。; error-recovery clarity: 失敗の理由が書かれておらず、主要アクションは同じ操作の再試行のみ。パンくずは出ているが自力で辿るための手掛かり（コピー等の操作）が絵の中にない。; error-recovery clarity: 設定画面を開けなかった原因の説明がなく、再試行以外の代替手段(手動パスの案内など)が提示されていない |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | consistency: 同じ画面収録許可フローに対して文言バリエーションが複数あり(0681と本画像)、ユーザーが状況の違いを理解しにくい |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP× opus:KEEP sonnet:FIX | typography: 左端のピクトグラムが「スクリーンショット」の意味と合致しない形状で、アイコンの意図が読み取れない |
| `screenshot.detected` | FIX_CANDIDATE | haiku:KEEP× opus:FIX sonnet:FIX | state legibility: 「読み込み中／認識済み」の違いが、暗い背景の上の小さな灰色 1 行だけで表現されている。太字の見出しもサムネイルも前の状態と同じで、状態が変わったことに気づきにくい。; contrast: 状態を伝える唯一の文字列が、濃いグレー地の上に細く小さい中間グレーで置かれており、見出しとのコントラスト差が大きい。; state legibility: 異なる処理状態(送信前と認識済み)なのにアイコン・色・レイアウトが同一で、状態遷移が視覚的に区別できない |
| `guided-setup.target-highlighted` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX | state legibility: Red badge with number '1' is unexplained—unclear if it indicates errors, notifications, or prerequisites; consistency: Only AstraDbg has explanatory text about restart requirement; ChatGPT and AnyDesk lack any description, creating uneven information hierarchy; trust-provenance: 画面 |
| `guided-setup.granted` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | state legibility: 円形バッジ内の縦棒3本が何の状態を表すか（録音中/待機中/音量レベル）が絵から読み取れず、成功メッセージと合わせて『いま録画されているのか』が判断できない; alignment: 円形バッジが pill の上下からはみ出しており、高さ・中心線が揃っていない。左に離れた pill と視覚的に一体でも独立でもない中途半端な配置; consistency: 通知トーストと隣接する円形アイコンボタンが同じ高さ・行に並んでいるが視覚的に無関係な2つの要素に見え、グルーピングの意図が不明瞭 |
