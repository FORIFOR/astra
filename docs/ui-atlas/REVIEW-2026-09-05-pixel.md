# UI Atlas — pixel-level visual review (2026-09-05)

対象: ui-atlas ブランチ 5e9cdeb / 凍結 RC 349007f / exe SHA256 390b3633…bdc37c87
見たもの: `docs/ui-atlas/screens/` の 96 PNG すべて（light 52 + dark 44。dark のうち 13 は light と同一 SHA、
残り 31 は個別に目視）と `strips/` の 2 本。PDF ではなく元 PNG を実寸で見た。
採点者: Claude（Claude Code セッション）。単独 1 名の目視であり、外部レビュアの独立パスの代わりではない。
根拠に「観察」を先に書き、寸法は測っていない値を書かない（測っていないものは「未測」）。

## 判定の要約

| Verdict | 件数 | 内訳 |
| --- | --- | --- |
| KEEP | 41 | 下表 |
| FIX | 5 | meeting.captions / system.mic-denied / main.apps-connectors / main.work-agents / main.new-recording-sheet |
| NOT_ENOUGH_EVIDENCE | 15 | NO_CAPTURE_PATH 13 + 撮れているが state の証拠にならない 2（meeting.workspace / session.detail） |
| 合計 | 61 | required 61（optional 5 は末尾に別掲） |

FIX 5 件のうち Craft Freeze override が要るのは 2 件（apps-connectors / work-agents。いずれも局所レイアウト）。
残り 3 件は文言・状態結線だけで、寸法・色・段には触れない。

VISUAL_IDEAL_GATE は引き続き NO-GO（captured 48/61、strips 2/5、FIX 5）。
ただし FIX はどれも局所で、13 面 + 3 strip の撮影経路追加と同じ新 RC 1 回に同梱できる。

## 61 state

```text
voice.idle                       KEEP
voice.preparing                  KEEP
voice.listening                  KEEP
voice.thinking                   KEEP
voice.context                    KEEP
voice.context-expanded           KEEP
voice.quick-actions              NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
dock.running                     KEEP
dock.context-detail              KEEP   (観察: Screen カードの「画面 / 画面」は dock8 fixture の summary="画面"。UI ではない)
dock.confirmation                KEEP
dock.confirmation-edit           NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
dock.result                      KEEP
dock.result-failed               NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
meeting.controller               KEEP
meeting.preparing                NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
meeting.paused                   NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
meeting.notes                    KEEP
meeting.captions                 FIX    (F1)
meeting.ask                      NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
meeting.workspace                NOT_ENOUGH_EVIDENCE   (E1: 撮っている窓が Main Window。Workspace 面ではない)
recording.workspace              KEEP
recording.transcript             KEEP
recording.rag                    KEEP
recording.agent-timeline         KEEP
recording.meeting-canvas         KEEP
main.home                        KEEP
main.home-recording-now          KEEP   (観察: 非アクティブ窓で撮れている。Dock が key のまま。撮影条件で UI ではない)
main.home-upcoming               KEEP
main.new-recording-sheet         FIX    (F5, 文言のみ)
main.work-tasks                  KEEP
main.work-agents                 FIX    (F4)
main.library-meetings            KEEP
main.library-files               KEEP
main.apps-plugins                KEEP
main.apps-connectors             FIX    (F3)
session.recording                KEEP
session.processing               KEEP
session.ready                    KEEP
session.project                  KEEP
session.detail                   NOT_ENOUGH_EVIDENCE   (E2: fixture が件数だけ与え item を与えないので Home カードと矛盾して見える)
provenance.meeting-detail        KEEP
provenance.library-after-end     KEEP
provenance.source                KEEP
provenance.reopened              KEEP
system.mic-denied                FIX    (F2)
system.mic-recovered             KEEP
system.after-sharing             KEEP   (観察: 画素は mic-recovered と同型。「共有中に映らない設定が戻る」は画素からは読めない。後述)
system.confirm-cancel            KEEP
system.interrupted               KEEP
system.resumed                   KEEP
system.stt-unavailable           NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
system.calendar-permission       NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
system.accessibility-permission  NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
system.update-available          NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
system.update-unavailable        NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
system.generic-failure           NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
settings.permissions             NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
components.neutral               KEEP
components.hover                 KEEP
components.focus                 KEEP
components.pressed               KEEP
```

optional（required=false）:

```text
dock.entering-recording          NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
main.scale-compact               KEEP
main.scale-comfortable           KEEP
main.scale-large                 KEEP
system.interrupted-journey       KEEP
```

strips:

```text
strip.idle-preparing-listening   NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
strip.dock-running               NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
strip.running-confirmation       NOT_ENOUGH_EVIDENCE   (NO_CAPTURE_PATH)
strip.controller-notes           KEEP   (drift 0 / creation 0 / focus theft 0 / 57.1 fps / max gap 26.4 ms)
strip.notes-workspace            KEEP   (drift 0 / creation 0 / focus theft 0 / 54.2 fps / max gap 69.3 ms — 1 回の 4 frame 落ち。閾値は SurfaceMotionGate に従う)
```

## FIX の詳細

### F1 meeting.captions — 字幕パネルの空状態に何も出ない

- 何が悪いか: Dock の「字幕」を開いた直後（transcript が空）の本文が、ツールバー以外まっさらの 820×460。
  同じ Dock の「メモ」は空でも「聞きながら、決まったこと・やること・懸念をここに書いていきます。」と言い、
  翻訳タブも「まだ訳すものがありません。」と言う。字幕タブと文字起こしタブだけ黙る。
- どこが理想基準未達か: manifest の invariant「字幕は話者と時刻が付く」以前に、「何も無いことを隠さない」
  （RecordingWorkspaceView の group() が守っている原則）を Dock 側が破っている。空面は「壊れている」と読まれる。
- 競合と比べ何が弱いか: Granola / Otter の live view は音声待ちの間に「Listening… transcript will appear here」を出す。
  Astra はここだけ無言。
- 修正すべき最小差分: `apps/astra-macos/Sources/AstraMac/VoiceHUD/VoiceHUDView.swift` の content `.captions` 内、
  `case .transcript` と `case .captions` の ForEach が空のとき、翻訳タブと同じ muted 1 行を出す
  （文言は Facts に 1 つ追加。例: 「まだ発言がありません。聞こえたらここに流れます。」）。
  ScrollView の高さや Dock 寸法は変えない。
- Craft Freeze override: 不要（文言のみ）。

### F2 system.mic-denied — 同じ面で「音声なし」と「聞いています」が並ぶ

- 何が悪いか: hero が「録音中（音声なし）」、banner が「マイクの許可が無いため、音声が記録されていません。」、
  transcript が「マイクが使えないので、聞き取れていません。」と言う横で、会議カードの見出しが
  「マイク と 画面の音 を聞いています」、本文が「聞いています…」と言う。
- どこが理想基準未達か: 「UI の意味と実装状態を一致させる」（VoiceHUDState.swift:49 の原則）と、
  RecordingWorkspaceView.swift:501 の「音が来ていないのに『聞いています』と言わない」を、この state で破っている。
  原因: hero の silent は `state.permissionIssue != nil`（RecordingHeroView.swift:8）で決まり、
  見出しと本文は `RecordingRuntime.shared.listening` の有無（RecordingWorkspaceView.swift:445-450 / 498-506）で決まる。
  2 つの真実が別。`listening` は insert しかなく（RecordingRuntime.swift:30-34）、拒否で消えない。
  shots selftest は listening を 2 ch 仕込んでから permissionIssue を立てる（SelfTest.swift:5847 / 5966）ので
  Atlas ではこの経路で出たが、本番でも「システム音声だけ生きてマイク拒否」で同じ絵になる。
- 競合と比べ何が弱いか: Krisp / Zoom は許可欠落時に「マイクなし」を 1 箇所で言い、同時に listening 表示を出さない。
- 修正すべき最小差分: `RecordingWorkspaceView.swift` の 2 箇所。
  1. `listeningLabel`: `state.permissionIssue != nil` のとき `.localUser` を parts から外す（残りが空なら nil）。
  2. `liveLine`: 最初の分岐に `if state.permissionIssue != nil { EmptyView() }` を足す
     （理由は banner と transcript が既に言っているので二重に言わない。440-443 行のコメントと同じ方針）。
  fixture 側（SelfTest.swift:5966 付近）は変えなくてよい。UI が正しければ同じ fixture で正しい絵になる。
- Craft Freeze override: 不要（表示条件のみ。寸法・色は不変）。

### F3 main.apps-connectors — 1 行に並ぶカードの高さが揃っていない

- 何が悪いか: Gmail / Google Calendar のカードは 3 行（名前・状態・理由）で高い。Finder は 2 行で低く、
  上端揃えのまま下端が段違い。light / dark とも同じ。
- どこが理想基準未達か: 同じ集合の要素は同じ器に入れる（DS の occupation / grid 規則の趣旨）。
  Plugins 画面は同じ問題を「補足行の有無に関わらずタグ行を底に置く」ことで避けており、Connectors だけ揃っていない。
- 競合と比べ何が弱いか: Raycast / Notion の integration 一覧はカード高さを固定し、状態行が無い場合も空行を保つ。
- 修正すべき最小差分: Connectors の card grid で `.frame(maxHeight: .infinity)` + 行の `fixedSize(horizontal: false, vertical: true)`
  で行内最大高に揃える、または Finder カードにも理由行（例: 「つなぐとこの Mac のファイルを読めます」）を必ず出す。
  後者は文言追加だけで済み、Craft Freeze に触れない。推奨は後者。
- Craft Freeze override: 前者なら YES（局所レイアウト）、後者なら不要。

### F4 main.work-agents — 空状態の様式が兄弟タブと違う

- 何が悪いか: Work/Tasks・Library/Meetings・Library/Files は空状態を中央に「見出し + 補足」の 2 行で出す。
  Work/Agents だけフィルタ chips の直下に左寄せ 1 行（「実行中の仕事はありません。Task Dock から…」）。
- どこが理想基準未達か: 同じ Main Window の同じ階層で空状態の型が 2 つある。読者は「壊れている方」を探し始める。
- 競合と比べ何が弱いか: Linear / Things はフィルタ結果が空でも同じ empty-state コンポーネントを使う。
- 修正すべき最小差分: Agents の empty を Tasks と同じ empty-state view に差し替える
  （見出し「実行中の仕事はありません。」、補足「Task Dock から『◯◯して』と頼むとここに出ます。」）。
  chips はそのまま残す。
- Craft Freeze override: YES（局所レイアウト。ただし既存 component の再利用で新規造形は無い）。

### F5 main.new-recording-sheet — 値の言語が混じる

- 何が悪いか: ラベルは英語（Microphone / System Audio / Template / Save to / Project）で統一されているが、
  値が「MacBook Microphone / On / Meeting Notes / 自分だけ / None」と英日混在。特に Project の「None」と
  Save to の「自分だけ」が同じ列で隣り合う。System Audio は「On」の文字とトグルで同じことを 2 回言う。
- どこが理想基準未達か: 1 つの sheet 内で表記体系が 2 つ。sidebar（Home/Work/Library/Apps）の英語は
  「固有名は英語、文は日本語」という規則で説明がつくが、「None」はその規則の外。
- 競合と比べ何が弱いか: Granola の録音設定は値を全て 1 言語で出す。
- 修正すべき最小差分: Project の空値を「なし」に、System Audio の「On」文字列を落としてトグルだけにする
  （または「On」を「入」にする）。2 文字列の変更。
- Craft Freeze override: 不要（文言のみ）。

## NOT_ENOUGH_EVIDENCE のうち、撮れているのに証拠にならない 2 件

### E1 meeting.workspace — 撮っている窓が違う

- 観察: Atlas の画像は 1240×820 の Main Window（Home に「録音中 19:15 の会議」カード）。
  manifest はこの page を「会議の全体（文字起こし / メモ / 出典）を大きい面で扱う」「Workspace（2 枚目。T2 で測る）」
  「Dock の見出しはそのまま残る」と説明している。strip.notes-workspace の実フレームでは、Notes → Workspace で
  2 枚目に開くのは 1080 幅の Recording Workspace（カプセル付き）であり、Main Window ではない。
- 原因: dock8 selftest の `10-workspace` は `meetingEnded()` → `MainWindowController.shared.show()` の後に
  「幅が workspaceWidth より広い窓」だけを探して撮る（SelfTest.swift:559-581。コメント: 録音面がフェードアウト中に
  引っかかるので Main を幅で選ぶ）。つまり Workspace 面を意図的に避けている。
- 判定: UI の欠陥ではない。撮影経路の取り違え。13 面の harness 追加と同じ RC で、`10-workspace` を
  「meetingEnded しない・Dock を残したまま workspaceOpened → 1080×680 の窓を撮る」に直す。
  manifest の invariant「Dock の見出しはそのまま残る」はそのときに初めて検証できる。

### E2 session.detail — fixture が件数だけ与えている

- 観察: Home カード（session.ready）は「5 人 · やること 3 · 決まったこと 2」。同じ id を開いた detail は
  「決まったこと 0 / やること 0」「この会議の文字起こしはまだありません。」。同じ id が矛盾して見える。
- 原因: sessionshots selftest が `markReady(id: "s1", …, actions: 3, decisions: 2)` で件数だけ書き、
  artifact（item と transcript）を書かない（SelfTest.swift:2493 / 2679-2681）。detail は item を数える
  （MeetingArtifactView.swift:92）。本番の `finishProcessing`（RecordingWorkspaceState.swift:309-330）は
  canvas の件数を markReady に渡すので、本番で両者が食い違う経路は見つからなかった。
- 判定: UI の欠陥ではない。fixture が「同じ id が姿を変える（矛盾しない）」の invariant を自分で破っている。
  新 RC の sessionshots で、markReady と同時に同じ件数の item を artifact に書く。

## KEEP に付けた観察（FIX ではない）

- 13 面の light == dark（voice / dock / meeting）: Dock/HUD は ambient floating surface として固定色。
  仕様として一貫している。manifest に `appearance_policy: fixed` を 1 つ足す提案に同意。
- main.home-recording-now / provenance.library-after-end: 非アクティブ窓（traffic lights グレー）で撮れている。
  Dock が key のまま Main を撮った結果で、UI の欠陥ではない。Atlas の見栄えだけなら撮影前に Main を key にする。
- system.interrupted / interrupted-journey の sidebar に淡い明部: sidebar の vibrancy が背後の窓を透かしたもの。
  クロップして確認、UI 要素ではない。
- system.after-sharing: 画素は mic-recovered と同型（controller 00:02）。manifest の「共有中に映らない設定が戻る」は
  Journey C の ids（hiddenWhileSharing / backAfterSharing）が保証しており、画像は「戻ったあとの Dock」の証拠。
  KEEP とするが、次 RC で共有中の 1 frame（Dock が無い）を strip に足せば画素でも言える。
- strip.notes-workspace の max gap 69.3 ms: 60fps で 4 frame ぶんの 1 回の落ち。SurfaceMotionGate の閾値内なら KEEP。
  閾値は本文書では判定していない（未測）。
- dock.context-detail の Screen カード「画面 / 画面」: fixture の summary が "画面"（SelfTest.swift:488）。
  本番では画面の要約文が入る。UI ではない。

## この文書が言っていないこと

- 寸法（pt）や色差の実測はしていない。DS-01〜05 の数値検証は `--selftest occupation` / golden が担う。
- 動きは strip 2 本の静止フレームしか見ていない。60fps の連続性は SurfaceMotionGate の数値に従う。
- 外部レビュアの独立パスが未了のあいだ、この判定は 1 名の目視として扱う。
