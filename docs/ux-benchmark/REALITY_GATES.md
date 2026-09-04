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
RELEASE_ARTIFACT           PENDING        → 次の release で verify-release-artifact.sh（egress / calendarask / update）+「更新を確認…」
```

検査は OS の設定を変えない（本人の方針）ので、上の 4 つは本人が回す。結果はこの dir に日付つきで置く。
判定の形は 1 行ずつ `PASS / FAIL / NOT_MEASURED` と観察。FAIL だけが修正の入口。

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
