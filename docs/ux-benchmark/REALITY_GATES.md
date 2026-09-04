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

## 直すときの規則

```
実機測定
 ↓ 失敗した？   NO → 触らない
 ↓ YES
Evidence A/B が取れる？（層 A 実測 or 層 B 盲検）   NO → 記録のみ
 ↓ YES
最小修正 → 同じ測定器で再測 → verify-all → commit
```
