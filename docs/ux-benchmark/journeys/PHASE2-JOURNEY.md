# Journey Phase — 画面ではなく時間軸を通す

Craft Phase は 2026-09-03 に凍結した（`docs/DESIGN_SYSTEM.md` §0）。
ここからは radius / shadow / weight / spacing / border を個別に触らず、
3 本の Journey を**最後まで**通す。直すのは構造・寸法・意味だけ。

| Journey     | 通す道                                           | 見るもの                                     |
| ----------- | ------------------------------------------------ | -------------------------------------------- |
| J-A Task    | Home → Listening → Running → Confirmation → Done | 連続性・寸法・鍵の安全・体感の複雑さ         |
| J-B Meeting | Meeting → Notes → Workspace → Library → Source   | 出所の連続・用語・占有・状態の連続           |
| J-C Failure | 許可なし → 回復 / 落ちた → 再開                  | 回復・言い方・操作の主導権・行き止まりの無さ |

## 4 層で測る（どの層かを混ぜない）

| 層               | 何                                                                           | 自動修正 |
| ---------------- | ---------------------------------------------------------------------------- | -------- |
| A 直接測定       | 窓の数・焦点の移動・面の座標と寸法・遷移の時間・鍵の割り当て・出所 id の連続 | 許可     |
| B 検証済み評価者 | 階層・状態の読みやすさ・操作の見えやすさ・文法の一貫                         | 許可     |
| C 未検証の代理   | 体感の複雑さ・全体の連続感                                                   | 記録のみ |
| D 測れない       | ポインタの手触り・好み・全体としての信頼                                     | 測らない |

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

## 結果（2026-09-03、実装後）

### 層 A（直接測定、`scripts/verify-journeys.sh`）

| Journey | 基準（0306430） | いま     | 窓  | 焦点 | 操作 | 所要  |
| ------- | --------------- | -------- | --- | ---- | ---- | ----- |
| J-A     | 失敗 2          | **成功** | 0   | 0    | 4    | 5.3 s |
| J-B     | 失敗 4          | **成功** | 0   | 0    | 7    | 9.7 s |
| J-C     | 失敗 6          | **成功** | 0   | 0    | 4    | 7.3 s |

所要は `settle` の待ちを含む（遅延の指標ではない）。各段の遷移は 53〜195 ms。

J-A: Esc は listening→idle / result→idle、Return は no-op、⌘Return だけが承認
（`result.json` の `keys`）。5 段とも面は 1 枚、最大面は task dock 720x255。
J-B: 同じ id が Dock / recording / session / workspace / opened / DB に通る（`ids`）。
Source は `Ken|10:42` を求めて `Ken|10:42` が出た。読み戻し後も同じ行へ戻り、
DB の文字起こしは 3 行。
J-C: 拒否の理由は Dock の結果面（`dock:録音を始められません` + `openSettings`）、
共有中は隠れ・共有後は録音中でも戻る、確認の面は 1 枚、落ちた録音は interrupted で
開けて文字起こし 1 行が残る。

### 直したもの（すべて構造・寸法・意味。CRAFT_FREEZE_OVERRIDE は使っていない）

- J-B（35880e4）: 確定行と canvas を会議 id で保存（`transcripts` / `meeting_notes`）。
  会議の詳細を `MeetingArtifactView` に一本化し、開いた id の中身だけを出す。
  開始で前の会議を消す。結果面の「メモを開く」はその 1 件を開く。用語を 1 語ずつに
  （`scripts/lint-terms.sh`）。結べなかった要約に [0] を付けない。
- J-A（cfa1eaa）: Esc を key-equivalent の経路で受ける（`escapeKey`。`onExitCommand` は
  first responder の無い panel に届かない）。`Confirm.ask` は Dock が出ていれば Dock の
  1 面だけで待つ（modal card は Dock が無いときの代替）。
- J-C（04bed14）: 拒否は Dock の結果面に理由と「設定を開く」（`AgentResult.detail` /
  `failed`、`Action.openSettings`）。共有後は mode を問わず Dock を戻す。interrupted の
  カードを開く。設定に「入力監視（⌥Space）」。ステータスバーは「録音を開始 / 停止」。

### 層 C（記録のみ、直していない）

- J-B: 「Windows はいつ出しますか。」は ？ が無いので メモ に分類される（分類器の語彙）。
  Dock の Notes は メモ 群を出さない。Dock の群の順（懸念 → やること）が Library と違う。
- J-A: 体感の複雑さ = 段 5・面 1・増えた窓 0（代理の数字。体感そのものではない）。

### 層 D / 測れなかった

- その時刻の音声へ戻る（再生が未実装。飾りは置かない判断を維持）。
- 実際の声・実際の送信・実際の TCC 拒否・kill -9 を挟んだ全体
  （後者は `scripts/verify-recording-experience.sh` が別に見る）。

### 層 B（盲検 2 名、`journeys/panel1`）

基準（0306430）といまの各段の絵を A / B に伏せて並べ、観察を先に訊いた
（`panel1/prompts/judge.md`、鍵は `answers/key.txt`: JA A=基準 B=今、JB A=今 B=基準、
JC A=基準 B=今）。j1 = opus、j2 = sonnet。**2 名とも観察が鍵と一致**
（文・話者・時刻・語をそのまま書き出し、基準側で [番号] と出所の面が無いこと、
4 枚目で 決定事項 / アクション に揺れることを読んだ）ので、判定を採る。

| 軸                       | j1  | j2  | 読み                                                                                                                                   |
| ------------------------ | --- | --- | -------------------------------------------------------------------------------------------------------------------------------------- |
| JA control_visibility    | tie | tie | 静止画では Esc の有無は写らない（層 A で見る）。2 名とも「聞いている面に逃げ道の手がかりが見えない」「確認に鍵の表記が無い」と同じ観察 |
| JA state_legibility      | tie | tie | 5 段は両版とも読める                                                                                                                   |
| JB provenance_continuity | 今  | 今  | [1] → 出所 [1] 10:42 Ken → 文字起こしの行の強調、まで絵で繋がる                                                                        |
| JB grammar_consistency   | 今  | 今  | 基準は 3〜4 枚目で 決定事項 / アクション / ノート に揺れる                                                                             |
| JB state_continuity      | 今  | 今  | 題（08:59 の会議）と件数が終了 → 一覧 → 出所 → 開き直しで保たれる                                                                      |
| JB hierarchy             | 今  | 今  | 題 → 決まったこと/やること → 文字起こし → 出所 の段                                                                                    |
| JC recovery              | 今  | 今  | 理由 + 「設定を開く」、落ちた録音が開いて発言が残る                                                                                    |
| JC messaging             | 今  | 今  | 「録音を始められません」→ 理由 → 直し方、責める語が無い                                                                                |
| JC control               | 今  | 今  | やめる / 直す / 捨てる と「何が消えるか」                                                                                              |

**今 9 / 基準 0 / 引分 2**。

層 B から直したもの（1 件、構造・意味）: Listening の面に `esc` の表記を足した
（`KeyBadge`。鍵は効いていても、書いていなければ無いのと同じ。高さは変わらず、
golden `02-voice-hud-listening` を撮り直し）。
記録のみ: 確認面の「送る」に ⌘↩ の表記が無い（確認面は Craft ①〜⑨ を経た面。
次の round で構造として検討）。j2 は Workspace（暗い浮遊面）→ Library（明るい窓）を
両版とも「別の面に来た」と読み、j1 は「別のアプリには見えない」。**分かれた**ので
判定にせず記す。JC の「interrupted のカードが開けそうか」は両版とも「開けそう」
（見た目は同じ。押せるかは層 A の `session-<id>` で見る）。

## J-B の遷移中（2026-09-03、60fps 実測。`--selftest surfacemotion`）

段の前後の絵は「面が 1 枚のまま」を言えるが、**途中**は言えない。0.1.1 の操作ガイドの
評価で Dock → Notes → Workspace の連続が `SURFACE_CONTINUITY_MOTION = NOT_MEASURED` と
された（30fps の絵 2 枚では 180–220ms の morph は 5〜6 枚にしかならない）。
§4 の 5 行:

```
reference : v0.1.1 J-B Dock → Notes → Workspace のいまの振る舞い
hypothesis: 同一 NSPanel と anchor を保つ morph は、一つの Surface として連続して見える
measured  : 60fps window-only + CGWindowID / 窓の数 / 上辺 / 中心 / 寸法 / frame の連続
candidates: A = いま。測定で欠陥が確認されるまで UI 候補を作らない
gate      : Evidence A/B の失敗時のみ修正。measurement unavailable は FAIL にしない
```

測定器は `App/SurfaceMotionGate.swift`（`scripts/verify-journeys.sh` が JA/JB/JC の後に回す）。
状態を変えた瞬間から 700ms、16.7ms 刻みで自分の窓だけを撮る
（`CGWindowListCreateImage` を窓ごとに呼んで合成。画面は撮らない）。
記録は `docs/ux-benchmark/astra/JB-motion/result.json`（tick ごとの id・枠・alpha・画素差）と
最初の 16 frame の一覧（`T1-first16.png` / `T2-first16.png`）。

### 層 A（debug 5 回・release 2 回、どの回も同じ判定）

| 指標                          | 閾値 | T1 Meeting → Notes                       | T2 Notes → Workspace                                |
| ----------------------------- | ---- | ---------------------------------------- | --------------------------------------------------- |
| same CGWindowID               | 100% | **100%**（1 枚が伸びる）                 | **100%**（Dock は同じ id のまま）                   |
| 宣言していない窓              | 0    | **0**（1 枚）                            | **0**（頼んだ 2 枚目だけ）                          |
| focus theft                   | 0    | **0**                                    | **0**（前面のアプリは変わらない）                   |
| 上辺の移動                    | ≤2pt | **0.0pt**                                | **0.0pt**                                           |
| 中心の移動                    | ≤2pt | **0.0pt**                                | **0.0pt**                                           |
| 面が撮れなかった frame        | 0    | **0**                                    | **0**                                               |
| 高さの逆行                    | 0    | **0**（76→174 を 9 段で単調）            | —（Dock は 174 のまま）                             |
| 1 frame の最大の高さ変化      | 参考 | 全変化の 0.40（最初の 1 tick が 76→115） | 0                                                   |
| 2 枚目の枠の移動 / alpha 逆行 | 0    | —                                        | **0.0pt / 0**（1080x680 の中央、alpha は 0→1 単調） |
| 実効 fps / 最大 tick 間隔     | 参考 | 54–60 / 23–35ms                          | 37–56 / 46–256ms（下に書く）                        |

**SURFACE_CONTINUITY_MOTION = PASS**。Dock / Notes / Workspace には手を入れない。
**PERCEIVED_SURFACE_CONTINUITY = NOT_MEASURED**（fixture validation を通した動画の判定者がいない）。

### 層 C（記録のみ。閾値のある指標はどれも落ちていない）

- T1 の伸びている間、中身が一度消える。`VoiceHUDView.contentVisible` が mode の変化で
  0.12s かけて 0 になり、`dockResizeMs + dockContentDelayMs`（235ms）後に 0.12s で戻る。
  実測では 100–300ms の間、面は暗い板だけ（frame f008–f017、輝度 0.1–0.3/255）。
  「録音中」の見出しと 3 つのボタンは Meeting と Notes で同じ物なのに一緒に消える。
  これは §Animation の規則（縮む途中に中身がはみ出さないため）の結果で、画素差は
  1 frame あたり ≤ 9.3/255（跳ねではなく fade）。「別の面が載った」と感じるかは層 C。
  直すなら「変わらない見出しは消さない」が候補だが、盲検で欠陥と出るまで作らない。
- T2 は `detachMeetingSurface()` が 2 枚目を初めて作るとき main thread を止める。
  cold（起動後の初回）: debug 188–256ms、release 246ms。warm: release 46ms。
  止まっている間に 120ms の fade が進んでしまうので、cold では 2 枚目が 1 tick で
  alpha 0 → 0.98 に飛ぶ（fade が見えない）。warm では 0 → 0.83 → 0.92 → 0.98 → 1 と
  4 frame で見える。morph の欠陥ではなく初回生成の遅延。直すなら panel の先行生成だが、
  閾値の指標ではないので記録に留める。
- 測定器そのものの注意: 撮影で遅れた tick でも run loop を最低 1 回回さないと AppKit の
  アニメーション timer が止まり、**測定器が製品の欠陥を作る**（初版はこれで alpha が
  0 のまま 400ms 見えた）。60fps に届かない回は NOT_MEASURED として出し、FAIL にしない。
