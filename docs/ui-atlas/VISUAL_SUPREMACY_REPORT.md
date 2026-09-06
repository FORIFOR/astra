# VISUAL_SUPREMACY_REPORT — Astra 62 faces · RC b946708 / Atlas 17069b7

審査対象は現行 Atlas（62画面、7948bff の後継。Sparkle・許可・時刻整合・Dock 仕切りを反映済み）。
評価軸 8: Hierarchy / Density / Typography / Geometry / State clarity / Calmness / Craft / Distinctiveness。
各 archetype は最強の相手とだけ比べる。分類 = SUPREME / COMPETITIVE / BELOW BAR。
「AI が作った感」は失格条件。FIX には 弱点 / 競合の優位 / 直し方 / 具体寸法・配置・文字・状態 / 前後で測る指標 を付ける。

凡例: 🟢 SUPREME(=KEEP) · 🟡 COMPETITIVE(=FIX 推奨) · 🔴 BELOW BAR(=要 FIX)。
`Astra ⋛ competitor` は各行末に > / = / < で示す。

---

## 1. Idle / Invocation — vs Raycast + VoiceOS

### 🟡 voice.idle  — `Astra = VoiceOS` / `Astra < Raycast(比較対象外)`
- 8軸: Hierarchy○ Density○ Typography○ Geometry○ State○ Calmness◎ Craft○ **Distinctiveness✕**
- 弱点: 「● Astra [⌥][space]」は常駐 pill として静かで正しいが、**どの menubar アプリにも見える**。Astra だと分かる造形の署名が無い。
- 競合: Raycast は起動体そのものが大きな command palette で「呼び出す道具」だと一目。VoiceOS は pill だが波形の署名がある。
- 直し方: idle にも極小の波形/ドットの「声の署名」を 1 要素だけ足す（listening と連続する造形）。key cap は SF Symbols の `command`/`space` グリフに寄せて Raycast 級の質感に。
- 具体: pill 高さ 28pt 維持、accent dot 6pt→波形 3 本(2pt 幅)に置換、key cap は角丸 5pt・内側 1pt インセット。
- 測る: 盲検で「これは何のアプリか」を当てられる率、listening との造形連続（0→idle→listening の morph 60fps）。

### 🔴 voice.preparing / 🔴 voice.listening  — `Astra < Wispr Flow`
- 8軸: State○ Calmness○ Craft○ **Density✕(下段が弱い) Distinctiveness△**
- 弱点: 下段「見えている文脈はありません」が**否定形の空状態**。常駐 AI が起動直後に「無い」と言うのは冷たく、情報量も 0。波形は preparing でも出ており「準備中」と噛み合わない。
- 競合: Wispr Flow は listening 中、波形と直近の認識語だけを見せ、余計な否定文を出さない。
- 直し方: 文脈が無いときは下段を**出さない**（1 行に畳む）。文脈があるときだけ「◆ Notion を見ています」を出す。preparing は波形を出さず点滅ドットのみ、listening で波形に変わる（状態が造形で分かる）。
- 具体: 下段 line-height 0 化（畳む）、preparing の波形を削除しドット opacity 0.4 の pulse、listening で波形 amplitude を実レベルに。
- 測る: 起動→listening の morph 連続性、否定文の出現数=0、盲検で preparing/listening を静止画で区別できる率。

### 🟢 voice.thinking  — `Astra = Raycast`
- 「✨ 考えています…」1 行。静かで完成度が高い。KEEP。（✨ は AI 常套だが 1 箇所なので許容。気になるなら回転する細いスピナへ。）

## 2. Listening context — vs Wispr Flow + VoiceOS

### 🟢 voice.context  — `Astra = Raycast`
- 「◆ Notion ⌄」collapsed。見ている対象を静かに示す。KEEP。

### 🔴 voice.context-expanded  — `Astra < Raycast`
- 8軸: Hierarchy○ Density◎ Calmness○ **Typography✕(言語混在) Craft△**
- 弱点: 提案が全部**英語**（Summarize page / Extract action items / …）。他画面は日本語。列は同一サイズ・アイコン無し・強弱無しの平板なリスト。
- 競合: Raycast は各行にアイコン + 副次のヒント、選択行に淡い塗り。Astra は行の区別が無い。
- 直し方: 提案文を日本語に統一（「ページを要約」「やることを抽出」「未決の決定を探す」「このページに質問」）。各行に 16pt のモノトーンアイコン、選択行に 6% 塗り、副次に淡色の対象名。
- 具体: 行高 36pt、アイコン列 16pt+左 14pt、本文 13pt/500、SUGGESTED は 11pt/600 tracking+。
- 測る: 言語混在=0、盲検で「押せる行」と分かる率、hover/selected の視認。

### 🟢 voice.quick-actions  — `Astra = VoiceOS`
- 「✨聞く | ◉録音 | 88開く」3 操作の静かな行。KEEP。（アイコンが 88=grid はやや汎用。開く先が分かる字面なので許容。）

---

## 3. Task Running — vs VoiceOS + Raycast

### 🟢 dock.running  — `Astra > VoiceOS` / `Astra > Raycast`  ★flagship
- 8軸: Hierarchy◎ Density◎ Typography○ Geometry○ State◎ Calmness○ Craft◎ Distinctiveness◎
- 強み: タイトル→進捗バー→PLAN のチェックリスト（✓済/●実行中/○未着手 + 各ツールの実文）→CONTEXT 出所→止める/続ける。
  **「AI が複数手順の仕事を、計画と出所を見せながら進める」**という Astra 固有の完成形。競合に無い密度と正直さ。
- 微修正のみ: 右上「作業中 00:00 50%」が 3 値で詰まる。50% と進捗バーが二重。→ 右上は経過だけにし、% はバーに委ねる。KEEP。

### 🟡 dock.context-detail  — `Astra < Granola/Notion`
- 8軸: Hierarchy○ Density○ Calmness○ **Craft✕(内容が空語) Distinctiveness△** → AI 生成感の疑い
- 弱点: 3 枚のカード本文が同語反復（「Screen 画面 画面」「Selection 選択 画面の要素」）。**カテゴリ名を中身のように並べただけ**で、実際に見ているものが読めない。3 枚均等でテンプレ的。
- 競合: Granola/Notion の context カードは実スニペット（本文の一節・ファイル名・時刻）を出す。
- 直し方: カード本文を実文脈に（Notion=見出しの一節、Selection=選択テキスト先頭、Screen=前面ウィンドウ名）。同語反復を禁止。件数に応じて幅可変（3枚固定をやめる）。
- 具体: カード幅 min 180/max 220、本文 12pt/muted 2 行省略、種別ラベル 10pt/600。空語（"画面 画面"）はテスト（facts）で弾く。
- 測る: カード本文の同語反復=0、盲検で「Astra が今何を見ているか」を言える率。

## 4. Confirmation — vs Apple + Astra現行

### 🟡 dock.confirmation  — `Astra > Apple(情報量) / Astra = Apple(明瞭さ)`
- 8軸: Hierarchy○ Density○ State○ Craft○ **Consistency✕(やめる二重)**
- 強み: 宛先/差出人/本文/出所/「↗外部に出る」警告 + 送る(塗り) の階層は Apple 標準より豊かで正直。
- 弱点: 「やめる」が左のキーヒント（esc やめる）と右のボタンで**二重**。下段に 3 操作 + 2 ヒントで密。
- 直し方: キーヒント列とボタン列で同じ語を二度出さない。左はキー記号のみ（esc / ⌘⏎）、語はボタンだけに。
- 具体: 左下ヒントを "esc" "⌘⏎" のグリフだけにし語を除去、ボタンは やめる/直す/送る の 3 つに一本化。
- 測る: 同一ラベルの重複=0、破壊操作（送る）の視認優位（塗り面積・色差）。

### 🟢 dock.confirmation-edit  — `Astra = Apple`
- 本文が編集フィールドに、「やめる | 直し終える(accent)」。ラベルが動作を正しく述べる。KEEP。

### 🟢 dock.result  — `Astra = Apple`
- 「✓ 週次ブリーフィングを作る / 2件のソースから作成しました / 開く コピー」。静かで出所付き。KEEP。

### 🟢 dock.result-failed  — `Astra = Linear/Apple`
- 「⚠ …/「送信」で止まりました·接続が切れた / やり直す」。理由の本文色を濃くして可読。復旧が一目。KEEP。
  （微: やり直す をもう一段ボタンらしく。）

### (transition) dock.entering-recording — 静止画なし。5 transition の 1 本として §motion で扱う。

---

## 5. Meeting Controller — vs Granola + SuperIntern

### 🟢 meeting.controller  — `Astra = Granola`
- 「● Google Meet 05:12 | 波形 | 📄メモ 字幕 ✨Ask Astra ┃ ⑃ ⏸ ⏹」。出所+経過、タブ、仕切り、操作。静かで密度良し。KEEP。

### 🟡 meeting.preparing  — `Astra = Granola`
- 「○ 準備中… 00:01」時計が 0 から（整合済み）。ただし準備中でも波形が出ている（listening と紛れる）。
- 直し: 準備中は波形を出さずドット pulse のみ。録音開始で波形へ。測る: 準備中/録音中を静止画で区別できる率。

### 🟡 meeting.paused  — `Astra = Granola`
- 「○ 一時停止中 00:01」▶ で再開。仕切りで eye/操作を分離済み。ただし一時停止中も波形が動いて見える。
- 直し: 一時停止では波形を平坦/減衰。測る: paused を静止画で判別できる率。

### 🔴 recording.paused  — `Astra < Granola`  ★state-truth 矛盾
- 8軸: Hierarchy○ Density○ Craft○ **State clarity✕(矛盾)**
- 弱点: ヘッダは「一時停止中」+ 波形が動、なのに本文が「マイクと画面の音を**聞いています**」、下段は「決まったこと/やること を**待っています**」。**止まっているのに聞いている/待っている**と同居し、いま録れているのか止まっているのか読めない。
- 競合: Granola は pause 中「一時停止中・再開するまで記録しません」と明言し、波形を止める。
- 直し方: paused では (1) 波形を平坦化、(2) 副題を「一時停止中 — 再開するまで聞きません」に、(3) 「待っています…」を「一時停止中」に置換。
- 具体: `RecordingWorkspaceState.isPaused` で hero 副題と liveLine を分岐、波形 amplitude=0、空群の待機文を paused 文言へ。
- 測る: paused 面に「聞いています/待っています」語が 0、盲検で paused と recording を区別できる率 100%。

---

## 6. Live Notes / Captions / Workspace — vs Granola + Otter + Linear/Notion

### 🟡 recording.workspace  — `Astra = Granola`
- 8軸: Hierarchy○ Typography○ State○ Craft○ **Density△ Screen-occupation✕(両列とも下半分が空)**
- 弱点: 左列（決まったこと/やること が「待っています…」）と右列（transcript 3 行）とも**下 6 割が空白**。録音初期の正直な姿だが、広い窓に対し中身が上に偏り「余白が広いだけ」に見える。
- 競合: Granola は録音中、ライブ transcript を主役に大きく流し、空白を作らない。
- 直し方: 抽出が空の間は transcript を主役に（左列を畳むか、右 transcript を広げる）。決まったこと/やること は最初の抽出が出るまで見出しを小さく畳む。
- 具体: 抽出 0 件のとき左列 flex 0.7→0.4、transcript panel を縦いっぱいに。空群見出しは 11pt に縮小し skeleton を置かない。
- 測る: 非空領域率（面積占有）、盲検「画面の主役は何か」一致率。

### 🔴 meeting.notes / meeting.captions / meeting.ask  — `Astra < Granola` ★clock 矛盾（回帰）
- 弱点: 経過時計が 00:01 / 00:02 / 00:03 なのにメモ/字幕は 04:14〜05:01。**preparing の時計 0 リセットが後続 shot に漏れた**（私の直近修正の回帰）。
- 直し方: dock8 の shot 順で 08a-preparing / 08b-paused の後、09-notes 以降で elapsedSeconds を本編の値（≈ 312+）に戻す。
- 具体: `SelfTest` の 09-meeting-notes 直前に `RecordingWorkspaceState.shared.elapsedSeconds = 5*60+20`。
- 測る: 各 meeting 面で「時計 ≥ 最新メモ時刻」、盲検で時刻矛盾の指摘=0。

### 🔴 meeting.ask  — `Astra < SuperIntern`  ★空状態が弱い
- 8軸: Calmness○ **Screen-occupation✕ Density✕（入力欄 + 巨大な空白）**
- 弱点: 「ASK ASTRA / ✨この会議について聞く（入力）」だけで下は完全な空白。次の一手が無い。
- 競合: SuperIntern/Granola の Ask は「この会議の要約は?」「決定事項は?」等の**候補質問**を並べ、空白を作らない。
- 直し方: 入力の下に候補質問 3〜4（「要約して」「決定事項は?」「私の宿題は?」「反対意見は?」）を淡いチップで。過去 Q&A があればその履歴。
- 具体: チップ行 32pt、本文 13pt、最大 4 個、余白は候補で埋める。
- 測る: 空白面積率、盲検「ここで何ができるか」即答率。

### 🟡 meeting.captions  — `Astra = Otter`
- 弱点: 「字幕」が上部コントローラ・パネル見出し・サブタブの 3 箇所に出て別物を指す。字幕パネルの中に 文字起こし/翻訳/字幕 のサブタブがあり冗長。
- 直し方: パネル内サブタブを廃し、上部の メモ/字幕/Ask と一本化。パネル見出しの「字幕」を除く。
- 具体: captions パネルは speaker(accent)+文 の列だけに。サブタブ削除で縦 40pt 回収。
- 測る: 同一語「字幕」の出現箇所 ≤1、盲検で「どこを押すと字幕か」一意に答えられる率。

### 🟡 meeting.notes（内容の質）  — `Astra = Granola`
- 決まったこと/懸念/やること/質問 が時刻+話者付きで整理され、Granola 級。KEEP 相当（時計矛盾を直せば 🟢）。

### 🟡 recording.agent-timeline  — `Astra = VoiceOS`
- 右下「リアルタイム要約 / Zoom / ✓会話を用意する ●文字起こしを読む ○答えをまとめる」の手順表は dock.running 級で良い。
  ただし左列は空、source が上の Google Meet 文脈と食い違い「Zoom」。→ source を会議と一致させ、agent panel をもう少し大きく。

---

## 7. Home / Work / Library / Apps — vs Linear + Notion + Apple

### 🟢 (共通) sidebar ナビ  — `Astra = Linear`
- Home/Work/Library/Apps + 下部アカウント。アイコン+ラベル、選択の淡い塗り。Linear 級。KEEP。全面で一貫。

### 🔴 systemic: 空状態が「中央テキスト + 巨大な空白」  — `Astra < Linear/Apple`  ★最大の supremacy 欠陥
対象: main.work-tasks / main.work-agents / main.library-meetings / main.library-files / main.home(新規) / meeting.ask
- 8軸: Typography○ Calmness○ **Screen-occupation✕ Hierarchy△ Distinctiveness✕（AI 生成感の典型）**
- 弱点: どれも「まだ〜ありません。/ 〇〇から…」の**中央 2 行 + 下は完全な空白**。押せる操作が無く、別サーフェス名（Task Dock 等）を指すだけ。あなたが失格条件に挙げた「中央揃え empty state の乱用」「余白が広いだけ」に該当。
- 競合: Linear の空状態は 図版 + 1 文 + 明確な CTA ボタン。Apple は大きなグリフ + 簡潔文 + ボタン。
- 直し方（各面共通の型）: (1) その場で押せる主ボタンを置く（Tasks/Agents=「録音して話しかける」→ Task Dock を開く、Library=「録音を始める」、Home=大きめ録音 CTA）。(2) 空白に**次に起きることの見本**（薄い skeleton 1〜2 行 or 3 ステップの使い方）を左寄せで。(3) 中央寄せをやめ、上部の見出し帯に沿って左寄せ。
- 具体: 空状態ブロック幅 max 460、主ボタン 高さ 36/accent、補助文 13pt/muted、上から 1/3 の位置に固定（垂直中央にしない）。
- 測る: 非空領域率 ≥ 一定、各空状態に主ボタン 1、盲検「ここで次に何をするか」即答率、"AI 生成感" 指摘数=0。

### 🟡 main.home（新規ユーザー）  — `Astra = Apple`
- 「こんにちは / 何を終わらせますか?(入力) / ●録音を始める / まだ何もありません」。挨拶+コマンド入力+録音 CTA は良い。ただし下 2/3 空白。
- 直し: 上記 systemic 空状態の型を適用。録音済みが在る姿（home-recording-now）が主で、新規はオンボード 3 歩を出す。

### 🟢 main.apps-connectors  — `Astra = Notion`
- Gmail/Google Calendar/Finder の 3 カード（アイコン+名+状態⚠/○+説明）。状態が正直で Notion 級。KEEP。（下の空白は systemic 対応で軽減。）

### 🟡 main.work-agents（構造）  — `Astra = Linear`
- Active/Waiting/Done/Failed/All のフィルタ帯は良い。中身が空なのが問題（systemic）。フィルタは KEEP。

---

## 8. Library / Provenance / Session（データ有り）— vs Granola + Notion

### 🟢 session.detail  — `Astra > Notion` / `Astra = Granola`  ★flagship
- 要約→決まったこと[1][2]→やること[3][4][5]→(文字起こし/録音/関連ファイル/出所)→transcript。
  **主張に脚注番号を付け transcript の行へ結ぶ**引用が Astra 固有の信頼機能。密度・階層・craft とも最上級。KEEP。

### 🟢 provenance.source  — `Astra > Granola`  ★flagship
- 引用[1]を押すと右に「出所 10:42 Ken … 音声10:42」。主張→根拠→音声。競合に無い正直さ。KEEP。「1分未満」整合済み。
  微: 右パネルは 1 件だと下が空 → 出所が 1 件のときはパネル幅を細く。

### 🟢 main.home（データ有り / recent+upcoming）  — `Astra = Linear/Apple`
- 挨拶+入力+録音+これからの予定(録音ボタン)+最近の会議(今日·42分·5人·やること3·決まったこと2·自分だけ·Product)。占有良好・整合済み。KEEP。

### 🟢 main.home-recording-now  — `Astra = Linear`
- 録音中の赤み帯カード（●録音中 00:01 / 会議 / Google Meet / 波形 / ライブメモを開く·Ask Astra / ■止める）。状態が一目。KEEP。（下の空白は systemic 対応で軽減。）

### 🟡 main.apps-plugins  — `Astra = Raycast store`
- 2 列のプラグイン格子（アイコン+名+版+✓+権限チップ+「この Mac の中だけで動きます」）。権限の正直さが distinctive。強い。
- 微 (AI 感の芽): 多数のカードが同一チップ「artifacts.read / artifacts.write」の反復、頭文字アバター（A/G/C…）が汎用。
- 直し: 代表権限を 1〜2 個に要約し「+N」で畳む（Meeting Agent の様に）。アバターは各プラグインの色/記号で差を付ける。測る: 同一チップ連続の割合、盲検でカードを区別できる率。

---

## 9. Errors / Recovery / Permissions — vs Linear + Apple

### 🔴 system.confirm-cancel  — `Astra < Apple`  ★破壊確認の設計不良
- 8軸: State○ Craft○ **Primary-action✕ Consistency✕**
- 弱点: 録音破棄の確認なのに (1)「やめる」がキーヒントとボタンで二重、(2) 二択で良い所に「直す」が混じり三択、(3) `⌘⏎` が**破壊操作「捨てる」に既定バインド**（誤爆しやすい）。
- 競合: Apple の破棄シートは 二択（キャンセル / 削除）、既定は安全側（キャンセル）、削除は赤。
- 直し方: 破棄確認は二択（やめる / 捨てる）に。`直す` を除去。`esc`=やめる、`⌘⏎` は付けない（破壊を既定にしない）。捨てる=赤塗り維持。
- 具体: ボタン 2 つ、左下ヒントは `esc` のみ、Return はハイライトしない。
- 測る: 破壊操作が既定 Return でない、同一ラベル重複=0、選択肢数=2。

### 🟡 system.interrupted  — `Astra = Linear`
- recent に「⚠ 落ちた会議 / 途中で終わっています·開くと確定した行までは見られます」。正直で分かりやすい。
- 弱点: その場の復旧操作（再開/破棄）が無く「…」に隠れる。「プロジェクト無し」は「なし」に統一。
- 直し: カード右に軽い「開く」主導線。測る: 復旧導線がカード上に見える率。

### 🟢 system.stt-unavailable  — `Astra > Apple`
- 赤帯「この Mac ではオンデバイス文字起こしを使えません。音声は保存されています  設定を開く（音声入力）」。
  何が壊れ / 何は無事 / どう直すを 1 行で。正直さが distinctive。KEEP。

### 🟢 system.generic-failure  — `Astra = Linear`
- recent「⚠ 先方へ見積の返信を送る /「送信」で止まりました / 1/2 11:43 やり直す」。失敗の位置と再試行が一目。KEEP。

### 🟡 system.accessibility-permission  — `Astra = Apple`
- 新規 home の空状態に「⌥Space を使えるようにする →」。導線は良いが空状態が sparse（systemic）。

### 🟡 components.hover / focus / pressed / neutral  — `Astra = Linear`（DS 参照面）
- コンポーネントの状態見本。hover は「AI が見ている資料 3件」pill の強調で機能。DS 参照として妥当。
- 弱点: 背景の workspace が空（左列 待機・右 3 行）で、状態見本としてノイズ。→ 見本は最小背景に。測る: 見本対象が一意に分かる率。

---

## 10. Settings / Update / Scale / 残り

### 🔴 main.new-recording-sheet  — `Astra < Apple`  ★言語混在
- 8軸: Geometry○ Density○ Calmness○ **Typography✕(英語ラベル) Consistency✕**
- 弱点: フィールド名が英語（Microphone / System Audio / Template / Save to / Project）、値と操作は日本語（自分だけ / なし / 録音を始める）。テンプレ名も英語（Meeting Notes）。日本語アプリで**ラベルだけ英語**。
- 直し方: ラベルを日本語に（マイク / 画面の音 / テンプレート / 保存先 / プロジェクト）。テンプレ名も日本語化。
- 具体: ラベル列 12pt、値列と baseline 揃え。fact() で英語ラベルの残存をテスト。
- 測る: 言語混在=0（DS-06 の綴り正本に統合）。

### 🔴 main.library-files  — `Astra < Linear`  ★systemic 空状態
- All/Report/Document/Image/Video/Other のフィルタは良いが、中央「まだ資料はありません。」+ 空白。§7 systemic の型を適用。

### 🟢 settings.permissions  — `Astra = macOS Settings`（前巡で修正済み）
- 節名日本語化・許可理由を濃く。マイク/画面収録/アクセシビリティ/音声認識/カレンダー/入力監視の 6 行。KEEP。
  微: 6 行が同じ視覚重量で並ぶ（未確認/許可済みの状態色はある）。カテゴリ間の区切りを 1 段入れると更に良い。

### 🟢 system.update-available / update-unavailable  — `Astra = Sparkle/native`（前巡で修正済み）
- available=本物のリリースノート+版、unavailable=事実+版+次の一手。内向き語を除去済み。KEEP。

### 🟢 main.scale-compact / comfortable / large  — `Astra = Linear`
- 同一 Home を 3 密度で。文字だけでなく面・余白も一緒に動く。一貫。KEEP。

### 🟢 session.processing / session.recording / session.project  — `Astra = Granola`
- recent カードが状態（●録音中 / ○文字起こしを保存しています… / ready）で正直に変わる。KEEP。

### 🟢 provenance.meeting-detail / library-after-end / reopened  — `Astra = Granola/Notion`
- session.detail / provenance.source と同系の引用・出所付き詳細。KEEP。

### 🟡 system.mic-recovered / system.after-sharing / meeting.workspace / recording.transcript  — controller/workspace の別状態
- 5・6 章の判定に準ずる（波形/占有/paused の州別 clarity）。after-sharing の eye は仕切りで解決済み。

---

# SUMMARY — VISUAL_SUPREMACY_GATE

## スコアボード（62面 + 5 transition、代表 archetype で集計）
```
SUPREME (KEEP)        : 主に「データ有り」面 — dock.running / session.detail / provenance.source /
                        main.home(filled) / apps-plugins / apps-connectors / stt-unavailable /
                        generic-failure / result / result-failed / voice.thinking / voice.context /
                        meeting.controller / scale×3 / update×2 / settings.permissions ほか
COMPETITIVE (FIX 推奨): voice.idle / dock.confirmation / dock.context-detail / recording.workspace /
                        agent-timeline / meeting.captions / meeting.notes(時計) / interrupted /
                        apps-plugins(反復) / components×4 ほか
BELOW BAR (要 FIX)    : voice.preparing / voice.listening / voice.context-expanded /
                        recording.paused(矛盾) / meeting.notes|captions|ask(時計回帰) /
                        meeting.ask(空) / work-tasks / work-agents / library-meetings /
                        library-files / system.confirm-cancel / new-recording-sheet
```

## 合格条件の判定（現時点）
```
required states                 62 / 62      ✅
obvious visual defect            > 0         ❌ (confirm-cancel の破壊既定, 時計矛盾)
inconsistent component           > 0         ❌ (英語ラベル/提案の言語混在 2面, やめる二重 2面)
weak empty/error state           > 0         ❌ (work×2 / library×2 / home新規 / ask = 6面)
AI-generated-looking surface     > 0         ❌ (中央空状態の乱用, context-detail の空語, chip 反復)
major competitor loss            軽微        △ (単独で competitor に明確に負ける面は無いが、空状態で見劣り)
material hierarchy loss           0          ✅
craft regression                 > 0         ❌ (時計矛盾は私の直近修正の回帰)
motion discontinuity             未評価       ⏳ (5 transition は §motion で別途)
```
→ **VISUAL_SUPREMACY_GATE = NO-GO**（重要項目に `Astra < competitor` と失格条件が残る）

## Astra ⋛ competitor（重要 archetype）
```
Astra > competitor : Task Running(dock.running) / Meeting Detail+Provenance(引用・出所) / STT 不能の正直さ
Astra = competitor : Invocation(idle以外) / Meeting Controller / Home(filled) / Settings / Update / Plugins
Astra < competitor : Empty states(Linear/Apple に明確に負け) / Ask(SuperIntern に負け) /
                     new-recording-sheet(言語) / confirm-cancel(Apple の二択安全既定)
```

## 直す順（UI をまとめて 1 回で。機能 FIX は据え置き）
1. **状態の真実**（最優先・craft 回帰）: recording.paused の「聞いています/待っています」矛盾、meeting.notes/captions/ask の時計回帰、preparing/paused の波形。
2. **空状態 systemic**: work-tasks / work-agents / library-meetings / library-files / home新規 / meeting.ask に「主ボタン + 左寄せ + 見本/オンボード」。中央寄せ空状態を全廃。
3. **言語混在**: new-recording-sheet のラベル、voice.context-expanded の提案。日本語に統一（DS-06 正本へ）。
4. **確認の設計**: confirm-cancel を二択・安全既定に。dock.confirmation の「やめる」二重解消。
5. **AI 感の芽**: dock.context-detail の空語、plugins の chip/アバター反復、components 見本の背景ノイズ。
6. **distinctiveness**: voice.idle に声の署名、idle→listening の造形連続。

## 測定器（この gate を自動化する側）
- 中央寄せ空状態の検出（レイアウトから centered-empty を数える）、空状態の主ボタン有無、言語混在（英字ラベル）検出は facts/geometry で機械判定できる。
- SUPREME/COMPETITIVE/BELOW BAR の盲検は review-blind.sh に「supremacy モード」（competitor 基準込み・3値分類）を足す。
- 「AI 生成感」チェックリスト（空語反復・同一 chip 連続・中央空状態・全カード同角丸）を静的に数える lint を作る。
