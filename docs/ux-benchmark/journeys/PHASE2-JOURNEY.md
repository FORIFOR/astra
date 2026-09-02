# Journey Phase — 画面ではなく時間軸を通す

Craft Phase は 2026-09-03 に凍結した（`docs/DESIGN_SYSTEM.md` §0）。
ここからは radius / shadow / weight / spacing / border を個別に触らず、
3 本の Journey を**最後まで**通す。直すのは構造・寸法・意味だけ。

| Journey | 通す道 | 見るもの |
| --- | --- | --- |
| J-A Task | Home → Listening → Running → Confirmation → Done | 連続性・寸法・鍵の安全・体感の複雑さ |
| J-B Meeting | Meeting → Notes → Workspace → Library → Source | 出所の連続・用語・占有・状態の連続 |
| J-C Failure | 許可なし → 回復 / 落ちた → 再開 | 回復・言い方・操作の主導権・行き止まりの無さ |

## 4 層で測る（どの層かを混ぜない）

| 層 | 何 | 自動修正 |
| --- | --- | --- |
| A 直接測定 | 窓の数・焦点の移動・面の座標と寸法・遷移の時間・鍵の割り当て・出所 id の連続 | 許可 |
| B 検証済み評価者 | 階層・状態の読みやすさ・操作の見えやすさ・文法の一貫 | 許可 |
| C 未検証の代理 | 体感の複雑さ・全体の連続感 | 記録のみ |
| D 測れない | ポインタの手触り・好み・全体としての信頼 | 測らない |

測り方は `apps/astra-macos/Sources/AstraMac/App/JourneyRecorder.swift` と
`SelfTest.swift` の `journeyGate`（`--selftest journey JA|JB|JC <dir>`）。
記録は `docs/ux-benchmark/astra/JA|JB|JC/result.json` と各段の絵。

## 調査メモ（2026-09-03、実装前）

読んだもの: `App/SelfTest.swift`（journeyGate J04/J05/J07/J09/J10、focus、confirmflow、
dockanim）、`App/JourneyRecorder.swift`、`App/UIProbe.swift`、`Components/Confirm.swift`、
`Action/ConfirmationPresenter.swift`、`Core/AstraStateStore.swift`、`Core/MeetingSessionStore.swift`、
`Storage/LocalStore.swift`、`RecordingWorkspace/RecordingWorkspaceState.swift`、
`Meeting/SessionDetailView.swift`、`Meeting/MeetingArtifactView.swift`、`Main/MainWindowView.swift`、
`Windowing/PresentationGuard.swift`、`Windowing/WindowCoordinator.swift`、`Settings/Permissions.swift`。
加えて 3 本の探索（selftest の地図 / 出所 id の流れと用語 / 鍵・焦点・失敗経路）。

### 在るもの

- `JourneyRecorder` は 1 段ごとに ms・操作数・**増えた**窓・前面の移動を持つ。
  絶対の窓数、key の有無、面の座標、遷移時間、鍵、id は持たない。
- `UIProbe` は Workspace の canvas 行（`canvasItem-*`、`canvasEdit`、`canvasRemove`、
  `canvasContext`、`canvasUndo`）にだけ在る。Library・確認・結果には無い。
- `sessionsync` が Home / Dock / DB の会議 id 一致を見る。**Workspace より先は誰も見ていない。**

### 無いもの（層 A で落ちるはずのところ）

J-B

- 文字起こしと拾ったもの（canvas）は**保存されない**。`transcripts` 表は在るが insert が無い。
  停止すると要約 1 行と件数だけが残る。Library で「[1] → Ken · 10:42 → 原文」へ戻れない。
- 実際の会議の詳細は `SessionDetailView`。中身は `RecordingWorkspaceState.shared.transcript` と
  `state.meeting.canvas` の**いまの**値で、開いた session の id で絞っていない。
  古い会議を開くと直近の録音の中身が出る。
- 引用番号と根拠の面を持つ `MeetingArtifactView` は固定の標本（"A社 新規提案"）でしか出ない。
  実データから来る道が無い。
- `transcript` は録音の開始で消えない。2 本目の録音で 1 本目の行が混ざる（`at` も衝突）。
- 用語が面ごとに違う: 決まったこと／決定事項、やること／アクション、質問／宿題、
  メモ／ノート、出所／出典／根拠。
- 結果面の「ノートを開く」は一覧を開くだけで、その会議を開かない（1 クリック余計）。
- 音声へ戻る手当ては無い（再生が未実装。飾りは置かない判断を維持し、測れないと記す）。

J-A

- `Confirm.ask` は Dock の確認面と `ConfirmationPresenter` の modal panel を**両方**出す。
  Dock 側で答えると modal が 120 秒残る。1 つの判断に 2 つの面。
- Esc が効くのは確認面だけ。Listening（マイクが開いている）と結果面に逃げ道の鍵が無い。
  「逃げ道は常に同じ鍵」（`VoiceHUDView.swift` の確認面の注記）に反する。
- Return が外へ出る操作を走らせる箇所は無い（⌘Return だけ）。Ask 欄の Return は gateway へ送る
  （外部サービスへの書き込みではない）。

J-C

- マイク拒否: `start()` は早期 return し、理由は Workspace のバナーにしか出ない。
  Workspace は開いていないので、Home / Dock / 予定 / ⌥Space のどこから始めても**何も起きない**。
- ⌥Space の許可（入力監視）を直す道は Home が空のときだけ出る。設定の「許可（OS）」に行が無い。
  ステータスバーは「音声入力: ⌥Space を長押し」と言うが、実装は録音の開始/停止。
- 画面共有中に Dock を引っ込めた後、共有が終わっても `mode == .meeting` の間は戻らない
  （`PresentationGuard.apply`）。録音中に Stop を含む Dock が消えたまま。
- 落ちた録音は `interrupted` として残る（良い）。ただし文字起こしは保存されていないので中身が無い。
  interrupted のカードは押しても開かない。

## 計画（実装の順）

1. 計測器: `JourneyRecorder` に 1 段ごとの絶対の窓数・key・前面・最大面の座標寸法・遷移時間・
   鍵の応答・出所 id を持たせる。確認面と Library の操作に `ProbeButton` を足す。
   `--selftest journey JA|JB|JC` を実データの状態機械で通し、**先に落とす**（基準値）。
2. J-B: 文字起こしと拾ったものを会議 id で保存（確定行ごとに書き込む）。会議の詳細を
   `MeetingArtifactView` に一本化し、開いた id の中身だけを出す。開始で前の会議を消す。
   結果面の「メモを開く」はその会議を開く。用語を 1 語ずつに揃える。
3. J-A: 確認は Dock の 1 面だけ。Listening と結果面に Esc。
4. J-C: マイク拒否は Dock の結果面に理由と「設定を開く」を出す。設定に入力監視の行。
   ステータスバーの文言を実装に合わせる。共有が終わったら録音中でも Dock を戻す。
   interrupted のカードを開けるようにする。
5. 再計測 → 各段の絵で B 層の盲検（連続性・状態・操作・文法）→ 記録 → `verify-all` → commit。

CRAFT_FREEZE_OVERRIDE は使わない見込み（どれも構造・寸法・意味で直る）。
