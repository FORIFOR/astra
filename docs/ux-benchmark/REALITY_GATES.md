# 実機で閉じる残り 5 つ（2026-09-04、本人の判定）

UI の改善案はもう作らない。ここから先は **実機測定 → 失敗したときだけ → Evidence A/B が取れるときだけ → 最小修正**。
失敗が出ていない面は触らない（測れていない主観を理由に変えない、`docs/DESIGN_SYSTEM.md` §0）。

## 確定した面（2026-09-04）

```
VISUAL_CRAFT               FROZEN
HOME                       KEEP
NAV_4                      KEEP     （Home / Work / Library / Apps、7b2865d、盲検 12/12）
MEETING_DOCK               KEEP
LIVE_NOTES                 KEEP
WORKSPACE                  KEEP
LIBRARY                    FREEZE
AGENT_RUNNING              KEEP
CONFIRMATION               FREEZE
DONE                       KEEP
RECOVERY                   KEEP
PRIVACY_DEFAULT_LOCAL      PASS     （96a0405、verify-privacy-egress.sh）
CALENDAR_PURPOSE_FIRST     KEEP     （3b870ce、--selftest calendarask）
NEW_VISUAL_FIX             0
CRAFT_FREEZE_OVERRIDE      NO
```

## 未測定（人の手と実機が要るもの）

```
FULL_KEYBOARD_ACCESS       NOT_MEASURED   → a11y/RUNBOOK.md §1
VOICEOVER                  NOT_MEASURED   → a11y/RUNBOOK.md §2
LIVE_TCC                   NOT_MEASURED   → 下 §A
MEETING_CAPTURE_REALITY    NOT_MEASURED   → 下 §B（docs/privacy-egress.md にも同じ 4 行）
FINAL_COMPETITIVE_GATE     PARTIAL        → 下 §C（9 型のうち 4 型は Sample 22 で済み、5 型は hands-on 素材待ち）
RELEASE_ARTIFACT           PENDING        → 次の release で verify-release-artifact.sh（egress / calendarask / update）+「更新を確認…」
```

検査は OS の設定を変えない（本人の方針）ので、NOT_MEASURED の 4 つは本人が回す。結果はこの dir に日付つきで置く。
判定の形は 1 行ずつ `PASS / FAIL / NOT_MEASURED` と観察。FAIL だけが修正の入口。

## 3 つの Final Product Reality Gate（2026-09-04、本人の定義）

3 つとも PASS で `ASTRA PRODUCT UI/UX V1 = COMPLETE`。見た目はもう触らない。

```
1 REAL_MEETING_GATE        実 Meet / Zoom で 自分＋相手の音声・字幕・Notes・停止・Recovery     → §B（+ JC の Recovery を実機で）  NOT_MEASURED
2 ACCESSIBILITY_GATE       keyboard traversal / VoiceOver / focus order                      → a11y/RUNBOOK.md §1 §2            NOT_MEASURED
3 FINAL_COMPETITIVE_GATE   最新 Astra で archetype ごとに VoiceOS / SuperIntern と同型比較      → §C                              PARTIAL（9 型のうち 4 型は済み、5 型は素材待ち）
```

## §C FINAL_COMPETITIVE_GATE — 型ごとに 負ける / 同等 / 勝つ を確定する

総合 1 票で決めない。型は本人の定義どおり **9 つ**（Invocation / Listening / Task Running / Confirmation /
Meeting Controller / Live Notes / Workspace / Library-Provenance / Recovery）。Sample 22 の標本 6 つは、
このうち **4 型**に当たる——Captions と Transcript Attribution は Live Notes 型の**副標本**（Astra 側は
どちらも同じ `04-recording-transcript.png`、競合側だけ SuperIntern の別素材）で、型としては数えない。
post_meeting の標本が Library-Provenance 型。よって 4 型が済み、5 型が hands-on 素材待ち（4 + 5 = 9）。
測ったのは Sample 22（`compare/SAMPLES.md`、HEAD 3b870ce の golden vs 2026-09-02 取得の公式素材、
2 名盲検、1 標本 = 1 票）。

```
FINAL_COMPETITIVE_GATE（2026-09-04、Sample 22）
  Invocation              NOT_COMPARABLE   VoiceOS の起動・傾聴の公開 UI が無い   → voiceos/handson  V01 / V02
  Listening               NOT_COMPARABLE   同上                                  → voiceos/handson  V02
  Task Running            NOT_COMPARABLE   VoiceOS Agent 実行中の公開 UI が無い   → voiceos/handson  V06.mp4
  Confirmation            WIN              6 / 0 / 1 / 1（vs VoiceOS Gmail card）本文が切れない・外部警告・出所・esc / ⌘⏎
  Meeting Controller      SPLIT            4 / 3 / 0 / 1（vs SuperIntern Control Bar）
                                           勝つ: 階層・状態・操作・面の数   負ける: 密度・行の揃い・入力機器名の表示
  Live Notes              WIN              6 / 0 / 1 / 1（vs SuperIntern AI Canvas）
    └ 副標本 Captions       WIN            7 / 0 / 0 / 1（vs SuperIntern Summary / Transcript 2 窓）
    └ 副標本 Transcript Attribution WIN    5 / 2 / 1 / 0（vs SuperIntern 話者分離のデモ）負ける: 面の数・占有
  Workspace               NOT_COMPARABLE   相応する大面積 UI が公開素材に無い       → superintern/handson
  Library / Provenance    SPLIT            post_meeting 2 / 3 / 2 / 1（vs SuperIntern 会議後）
                                           勝つ: 要約→決定→やること の階層、[n] → 出所   負ける: 1 窓のまとまり・操作の数・占有
  Recovery                NOT_COMPARABLE   どちらの製品にも公開素材が無い          → handson（落ちて再開の画）
```

読み方:

- **負けが固定している軸は 2 つ**で、Sample 20 と同じ: surface_fragmentation（sidebar + 本文 + inspector の
  3 列、上に浮く Dock）と screen_occupation（窓だけ撮影 vs 壁紙の上の小窓。judge では測れない、
  `--selftest occupation` で見る）。どちらも凍結の対象で、失敗（実機）が出ていないので触らない。
- Meeting Controller の「入力機器名」は `.meeting = [.microphone]` の今は出すものが 1 つしか無い。
  §B で system audio を繋ぐ日に要否が決まる。
- craft は 5/6 → 3/6 に見えるが、動いた弁は画素で 2px 以内か、帯の透明部が黒く読まれた素材の限界
  （`compare/sample22/answers/craft-check.txt`）。CRAFT_FREEZE_OVERRIDE の根拠にならない。
  ```
  CRAFT_REGRESSION        NOT_SUPPORTED
  CRAFT_FREEZE_OVERRIDE   NO
  ```
- NOT_COMPARABLE の 5 型は、`voiceos/metadata.yaml` / `superintern/metadata.yaml` の版・取得日つきで
  hands-on の画が置かれたら、同じ prompt 型（`compare/sample22/prompts/`）で 2 名盲検を足して埋める。

## §A LIVE_TCC — カレンダーの「理由 → 許可 → OS ダイアログ → 予定がその場に出る」

未確認の端末（または TCC を戻した状態）でしか通らない。開発署名の .app で。

```
bash scripts/package-macos-app.sh                     # apps/astra-macos/.build/Astra.app（Apple Development 署名）
tccutil reset Calendar com.astra.desktop              # 本人が打つ（TCC を「未確認」に戻す。検査側は打たない）
open apps/astra-macos/.build/Astra.app                # メニュー → 「Astra を開く」→ Home
```

見るもの（順に）:

```
LIVE_TCC
  1 Home の「これからの予定」に「予定から録音を始める」+ 理由 + [カレンダーを許可 →] が出る   PASS/FAIL
  2 Home を開いただけでは OS のダイアログが出ない                                         PASS/FAIL
  3 [カレンダーを許可 →] を押すと OS のダイアログが出る（文言: 会議の予定を文脈として読むために…）PASS/FAIL
  4 許可 → 同じ場所に今日の予定（時刻のあるもの）が並ぶ。行の [録音] で題を引き継いで録れる        PASS/FAIL
  5 「許可しない」→ 行が消え、以後 Home に出ない。設定 → 権限 のカレンダー行から再許可できる       PASS/FAIL
```

4 で予定が 24 時間以内に無い場合は「並ばない」が正しい（架空の予定は出さない）。`open ... --args --selftest calendarlive`
で EventKit から実件数を出して突き合わせる（結果は `/tmp/astra-calendarlive.txt`）。

## §B MEETING_CAPTURE_REALITY — `.meeting = [.microphone]` にした結果の録れ方

実 Meet / Zoom を **スピーカー再生**で 1 度録る（`docs/privacy-egress.md` 末尾と同じ 4 行）。

```
MEETING_CAPTURE_REALITY
  local mic            自分の声が文字起こしに出る                                   captured / not
  remote speaker       相手の声がマイク経由で拾えている                              captured / not
  system audio         いまは未接続なので NOT_CAPTURED が正直                        NOT_CAPTURED
  screen permission    録音開始で画面収録のダイアログが出ない                          not required / required
```

remote speaker が not なら、直すのは UI ではなく system audio（ScreenCaptureKit / 仮想デバイス）を繋ぐ課題。
繋いだ時点で `.meeting` の JIT に「相手の声も記録する」として画面収録を戻す（`verify-privacy-egress.sh` は
`captureSystemAudio: true` と `.screenRecording` が両方あるときだけ PASS）。

## §D INVOCATION_WORLD_CLASS_GATE — 呼んだ瞬間を ms で測る（2026-09-04）

「⌥Space を押してから Astra が反応するまで」を層 A（直接計測）で測る。測定器は
`--selftest invocation [outDir]`（`InvocationGate.swift`、`result.json` を残す）。本番と同じ経路
（`GlobalShortcut` → `WindowCoordinator.toggleRecording()` → `RecordingWorkspaceState.start()`）を通す。
初回 ⌥Space は音声 HAL・SwiftUI・panel の cold を通るので 1 回捨て、2 回目以降（steady-state）を測る。
cold も別に記録する。この Mac（macOS 26.6.2、2026-09-04、責任プロセスに入力監視・音声認識の許可なし）:

```
INVOCATION_WORLD_CLASS_GATE（steady-state、5 回の代表値）
  idle screen occupation        0.47%    < 1%      PASS   220x44pt / 1920x1080（1440x900 なら 0.75%）
  shortcut → visible feedback   30–33ms  < 100ms   PASS   ← 直した（前は 180–410ms）。cold 初回も 57–61ms
  shortcut → microphone ready    ~320ms  < 200ms   MISS   音声 IO の最初のバッファ ~100ms が下限。回帰ではない
  speech end → processing state 21–64ms  < 150ms   PASS
  cancel latency (Esc)          13–27ms  < 100ms   PASS
  focus theft                   0        0         PASS
  extra windows                 0        0         PASS
  hotkey delivery               —                  NOT_MEASURED  入力監視なし（handler 直呼び。OS の受信を含まない）
  speech → first transcript     —        < 400ms   NOT_MEASURED  音声認識の許可がこの責任プロセスに無い
```

直したこと（層 A の失敗 → 最小修正）: `visible feedback` は 180–410ms で基準外だった。原因は
`MicCapture`（AVAudioEngine）の `start()` を主スレッドで待っていたこと（実測 60–170ms、cold は 200–770ms）。
engine を裏の直列 queue で起動し、画面は先に変える（開くまでの数十 ms は既存の「まだ音が届いていません」が出る）。
engine は録音のたびに作らず 1 台を使い回し、起動時に `prewarmMic()`（許可済みのときだけ `prepare()`。IO も要求も
しない）で資源を用意する。結果 30–33ms（cold 初回も 57–61ms）。回帰ガード（`InvocationGate` の regressionCeiling、
feedback<150ms 等）に入れた。録音・privacy・no-contradiction・pause・timer・sysaudio・JIT は緑のまま。

`microphone ready` の ~320ms は世界最高の目標に未達だが**回帰ではない**（gate は build を落とさない）。
下限は音声入力の最初の IO バッファ（この Mac で 4800 frames = 48kHz の 100ms）＋起動＋主スレッドへの hop。
<200ms に届かせるには (a) マイクを常時開けておく（待機中に録音インジケータが点く＝privacy コスト、却下）か
(b) 入力デバイスの buffer frame size を小さくする（capture 全体に影響する深い変更）のどちらか。今は測って記録だけ。
speech → first transcript は音声認識の許可がこの責任プロセスに無いので測れない（本人のターミナル署名 .app で測る）。

### INVOCATION_AUDIO_TRUTH — 呼んで即話しても冒頭を失わないか

本人の指摘: 大事なのは `mic ready < 200ms` そのものより「面が出た瞬間から安心して話せるか」。測定器は
`--selftest invocationaudio [outDir] [acoustic]`（`InvocationGate.audioTruth`）。マイクの取り込みは engine を
start してから最初の IO バッファまで **1 サンプルも入らない**（start 前を貯める ring バッファは無い＝コードの事実）。
だから「面が出てから取り込みが生きるまで」が冒頭を失う窓。この Mac（2026-09-04、mic 許可あり）で 2 回:

```
INVOCATION_AUDIO_TRUTH（この Mac、background job）
  loss window（面から取り込みが生きるまで）   ~105ms（= IO 最初のバッファ 1 枚）
  +0ms   に発話    first phoneme lost=1   first word fully lost=0
  +50ms  に発話    first phoneme lost=1   first word fully lost=0
  +100ms に発話    first phoneme lost=1   first word fully lost=0
  +200ms に発話    first phoneme lost=0   first word fully lost=0
  → 厳密には +0〜100ms で冒頭 ~105ms が欠ける（音素の頭）。語まるごとは一度も落ちない（窓 < 300ms）
```

窓は当初懸念した ~290ms ではなく **~105ms（IO バッファ 1 枚）**だった——`prewarmMic()` と engine 使い回しで
起動が暖まっているため。物理の窓そのものはハードウェアの下限で、マイク常時 ON 以外では消せない。

**そこで直したのは state truth（2026-09-05）。** 完成条件は本人の定義どおり
「**UI が Listening を名乗る = 実際に音声を取り込める**」。直す前の録音 Dock は、面が出た瞬間から
赤い録音ドット＋経過秒＋アプリ名（＝「録れている」の意味）を出しながら、最初の IO バッファまでの ~105ms は
1 サンプルも取り込んでいなかった。いまは**最初の音声フレームが着くまで**（`awaitingAudio`、タイマーではない）
見出しが `準備中…`（`Facts.recordingHeroPreparing`）で、ドットは赤くしない。フレームが着いた瞬間に
`録音中` と赤へ変わる。`--selftest invocationaudio` がこの不変条件を毎回検査する:

```
INVOCATION_AUDIO_TRUTH（この Mac、2026-09-05、state truth 修正後）
  取り込み前の見出し            準備中…        （録音中とは名乗らない）
  取り込みが生きた後の見出し     録音中          （準備中のまま固まらない）
  取り込み前に録音中を名乗った    0             ← 不変条件。破れたら SELFTEST_FAIL
  生きた後も準備中のまま         0             ← 逆向きの嘘も見る
  物理の窓（記録値）            ~106ms        （+0/+50/+100ms の生の欠けは残る。基準ではなく記録）
  → INVOCATION_AUDIO_TRUTH=PASS
```

つまり「録音中と見えてから話した音」は落ちない。物理の窓 ~106ms は記録値として残す（消すには
マイク常時 ON か buffer frame size の縮小が要るため、`MIC_READY_LATENCY_GATE`（target <200ms）へ送る）。
これは造形の変更ではなく、UI の意味と実装状態を一致させる修正。golden には 1 枚も影響しない
（録音 Dock は golden 9 枚に入っておらず、geometry は寸法だけを見る。light / dark とも差分は
`01-voice-hud-idle` のみで、これは入力監視が無い環境で待機 HUD の案内が「クリック」になる既知の差）。

**`.listening` も同じ条件で閉じた（2026-09-05、本人の決定 = 実際に capture を繋ぐ）。**
直す前の `beginListening()` は「聞いています…」と名乗りながら**マイクを開かず STT も動かしていなかった**
（`updatePartial` を呼ぶのは録音中の STT だけ、`.voiceStarted` の受け手も無い）。入口は 4 つ
（Home のマイク・Quick Actions「聞く」・Workspace・結果面の ask）で、~105ms の窓ではなく**恒久的**な
[[declared-not-enforced]] 型だった。いまは `RecordingRuntime.beginVoiceListening()` が実際に取り込む:

- 会議の録音とは別経路で、**`RecordingSession` を作らない**＝声の指示はディスクに残さない。
- 文字起こしは `SpeechTranscriber`（オンデバイス固定）だけ。外へは出ない（`PRIVACY_EGRESS_GATE` は PASS のまま）。
- 暖めてある同じ mic engine を使い回す。会議の録音中は二重に開かない（そのときは録音側の STT が partial を出す）。
- 最初の音声フレームが来るまで見出しは `準備中…`・orb は光らせない。来てから `聞いています…`。
- Esc（`cancelListening`）と発話確定（`speak`）でマイクを閉じる。

```
INVOCATION_AUDIO_TRUTH（この Mac、2026-09-05、Listening も実測）
  Listening 中にマイクが開いた        1        （以前は 0＝名乗るだけ）
  取り込み開始まで                   141ms
  取り込み前に「聞いています」と名乗った 0      ← 不変条件
  Esc でマイクが閉じた                1
  → INVOCATION_AUDIO_TRUTH=PASS（録音 Dock と Listening の両方）
```

golden は 1 枚も動かない。`02-voice-hud-listening` は撮影前に `markVoiceCaptureLive()` で
「取り込めている姿」を作ってから撮る（録音側で `markListening` を先に呼ぶのと同じ理由）。
light / dark とも差分は `01-voice-hud-idle` のみで、これは入力監視が無い環境の既知の差。

### PREPARING_VISUAL_GATE — 「準備中…」を絵で固定する（2026-09-05）

`準備中…` は実装都合の一瞬ではなく**正式な状態**になった。状態の並びは:

```
Idle → Preparing「準備中…」→（最初の音声フレーム）→ Listening「聞いています…」→ Result / Ask / Dictation
```

絵で固定しないと、`準備中…` が消える・取り込み前に指示子が光る・`聞いています…` が早く出る・
preparing だけ寸法が崩れる、といった state-truth の後退を画像側で捕まえられない。そこで golden を
**追加**した（既存の番号は整理せず churn を避ける）:

```
PREPARING_VISUAL_GATE
  01-voice-hud-idle            既存
  02-voice-hud-listening       既存・取り込みが生きた姿（markVoiceCaptureLive 後に撮る）
  02b-voice-hud-preparing      追加・まだ取り込めていない姿（beginPreparingForShot 後に撮る）

  preparing fixture exists              PASS  light / dark 両方
  listening fixture is capture-live     PASS  撮影前に markVoiceCaptureLive
  preparing != listening semantically   PASS  文言が 準備中… / 聞いています…、orb は非 active / active
  same window / same geometry           PASS  両方 600x79・dock.size() の差 ≤2pt（違えば shots が落ちる）
  取り込み前に指示子が光る                0     orb は active:false（塗り 0.78・影 0.30/r3）
  取り込み前に「聞いています…」            0     文言は listeningAwaitingAudio で切り替わる
  golden light / dark                   PASS
```

負例で確かめた: `02b` の絵を `02`（聞いています…）の絵に差し替えると golden が 1.89% 違いで落ちる。
つまり「取り込み前に聞いていますと名乗る」後退は画像で捕まる。orb だけの差も画素に出ている
（左 10% の領域だけで差分 bbox が立つ）。造形は変えていない——いまの姿をそのまま固定しただけで、
Craft Freeze は解いていない。

## WORLD_CLASS_UX_GATE — 世界一を数値で確かめる（2026-09-04、本人の定義）

「美しさ」ではなく数値。各行は測定器を持つか、持つべき。archetype ごとに**その面の最強の相手**と戦わせる
（平均的な競合ではなく）。

```
指標                          目標              いまの測定器 / 値
Intent 開始まで               < 1s              §D visible feedback 30–33ms（PASS）
Listening feedback            < 100ms           §D visible feedback（PASS）
不要な focus theft            0                 §D / JA / surfacemotion = 0（PASS）
通常操作の追加 window         0                 §D / JA / JB / JC windows+0（PASS）
Stop 可能な Agent state       100%              JA Confirmation で ⌘⏎/esc（層 A）
外部副作用前 Confirmation      100%             CONFIRMATION_GATE=PASS
AI conclusion → Source        ≤ 1 click         JB Source 1 操作（PASS）
Error → Recovery action       ≤ 1 click         JC マイク拒否→回復 1 操作（PASS）
top-level navigation 発見      ≥ 95%            NAV 4 面盲検 発見 12/12（nav-discovery）
keyboard-only core journeys   100%             ACCESSIBILITY_GATE（§2、人の実機、NOT_MEASURED）
VoiceOver core journey        100%             ACCESSIBILITY_GATE（同上）
idle occupation               < 1% screen       §D 0.47%（PASS）・occupation selftest
task completion               主要競合以上       §C（型ごと）+ hands-on
```

archetype ごとの「最強の相手」（総合ではなく、その面で一番強い製品と戦う）:

```
Invocation        → Raycast / VoiceOS      （§D は自分の実測。相手は hands-on 素材待ち）
Dictation         → Wispr Flow
Meeting calmness  → Granola
Post meeting      → Notion
Screen context    → VoiceOS / Copilot Vision
Confirmation / Provenance → Astra 自身の基準（§C で WIN / SPLIT）
Agent execution   → 上位 Agent UI
```

出典は公開素材のみ・版と取得日を `*/metadata.yaml` に記録（既存の盲検規約と同じ）。「Astra が製品全体として
上回った」とはまだ言わない。§C の 4 型（公開素材）は済み、5 型と WORLD_CLASS の人の実機分（keyboard / VoiceOver /
実 Meet / 音声認識 latency）は本人の端末で埋める。

## 直すときの規則

```
実機測定
 ↓ 失敗した？   NO → 触らない
 ↓ YES
Evidence A/B が取れる？（層 A 実測 or 層 B 盲検）   NO → 記録のみ
 ↓ YES
最小修正 → 同じ測定器で再測 → verify-all → commit
```
