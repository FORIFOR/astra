# RC セッション runbook — 同じ 1 本の署名済み .app で、残りの gate を全部閉じる

作成 2026-09-05。目的は**ビルドし直さないこと**。gate ごとに作り直すと、通した対象が毎回別物になる。
ここに書いた順で 1 セッションで回す。**FAIL / NOT_MEASURED が 1 つでもあれば NO-GO。**

前提: 自動で閉じられるものは全部緑（`--selftest invocation` / `invocationaudio`、golden、privacy-egress、
permission-JIT、journeys、recording-experience、no-contradiction、CI）。ここに残っているのは
**人の手と実機でしか測れないもの**だけ。

---

## 0. 先に済ませる（機械）

```bash
cd ~/Projects/astra
./scripts/verify-all.sh            # VERIFY_ALL_OK が出ること
git push origin main               # 3 commit（state truth ×2 + preparing golden）
gh run list --limit 1              # ci が success になるまで
```

`01-voice-hud-idle` が落ちるのは、回した端末に**入力監視の許可が無い**とき（待機 HUD の案内が
「⌥ space」ではなく「クリック」になる）。許可のあるターミナルで回せば通る。

**2026-09-05 に切り分け済み。** 署名 .app（入力監視は許可済み。`--selftest shortcut` が
`registered=true receivedSyntheticPress=true`）で撮り直すと **light / dark とも golden 10 面が一致**した:

```bash
open apps/astra-macos/.build/Astra.app --args --selftest shots /tmp/astra-rc/shots-light
open apps/astra-macos/.build/Astra.app --args --selftest shots /tmp/astra-rc/shots-dark dark
# 比較は画素演算だけなので許可の要らない実行体でよい
apps/astra-macos/.build/debug/AstraMac --selftest golden docs/golden-screenshots      /tmp/astra-rc/shots-light
apps/astra-macos/.build/debug/AstraMac --selftest golden docs/golden-screenshots/dark /tmp/astra-rc/shots-dark
# → SELFTEST_OK golden: 10面が committed の golden と一致（両方）
```

つまり golden の失敗は**環境の許可**の問題で、UI の後退ではない。新しい `02b-voice-hud-preparing` も
署名 .app 側の撮影と一致しているので、撮り直しは要らない。

**2026-09-05 07:47、本人のターミナルで `VERIFY_ALL_OK: この環境で検証できる全ゲートが緑`**（HEAD `77dab2b`）。
その run で本人の Mac が出した数字（全許可あり、経路 tap、画面 2560x1440）:

```
INVOCATION_WORLD_CLASS_GATE   measured 9/9, regressions 0
  hotkey delivery 31ms / visible feedback 36ms / processing 38ms / speech→first transcript 91ms
  cancel 23ms / focus theft 0 / extra windows 0 / idle occupation 0.26%
  microphone ready 314ms（<200ms 未達、IO バッファ下限、回帰ではない）
INVOCATION_AUDIO_TRUTH        PASS
  窓 104ms・Listening の取り込み開始 157ms・取り込み前に名乗った 0・Esc で閉じた 1
golden light / dark            10/10、geometry 6 状態 2pt 以内、density 13 面
```

## 1. 署名済み .app を 1 本だけ作る

TCC は**署名されたバンドル**に紐づく。ターミナルから実行体を直に叩くと責任プロセス（ターミナル）の
許可になり、実利用者と同じ状態を測れない。以下は開発署名で、公証も配布もしない。

```bash
bash scripts/package-macos-app.sh          # → apps/astra-macos/.build/Astra.app
open apps/astra-macos/.build/Astra.app     # 一度 LaunchServices 経由で起動して TCC の主体を作る
```

以降の selftest は必ず `open ... --args` で走らせる（stdout は読めないので、結果は
`--selftest <名> <出力先>` の `result.json` / `/tmp/astra-*.txt` で受け取る）。

**これ以降、コードを変えない。** 変えたらこの節からやり直す（同じバイナリで全 gate を通すのが要点）。

## 2. INVOCATION（signed acoustic）

```bash
open apps/astra-macos/.build/Astra.app --args \
  --selftest invocationaudio /tmp/astra-rc/invocation acoustic
# 少し待ってから
cat /tmp/astra-rc/invocation/result.json
```

見るのは `stateTruth` と `listeningTruth`。**PASS 条件:**

```
claimedLiveWhileDeaf       false   取り込み前に「録音中」と名乗らない
stuckPreparingAfterLive    false   生きた後も「準備中…」で固まらない
listeningTruth.captured    true    Listening が実際にマイクを開く
listeningTruth.claimedLiveWhileDeaf  false
listeningTruth.micClosedAfterCancel  true   Esc でマイクが閉じる
lossWindowFromSurfaceMs    記録値（~100ms。基準ではない）
```

`acoustic` の行（`recordedMs` の前後）は**当てにしない**。core は録音を断片単位（5 秒）で数えるので、
数百 ms〜2 秒の観測では 0→0 のままになる（2026-09-05 の署名版でも 0→0 だった。マイクは動いていて、
`lossWindowFromSurfaceMs` が出ている＝フレームは届いている）。判定の本体は上の 5 行
（UI の名乗りと実装状態の一致）で、loopback は将来つくるなら別の測り方が要る。

物理の窓（~100ms）は残る。消すにはマイク常時 ON か入力バッファ縮小が要るので、
別 gate（`MIC_READY_LATENCY_GATE` target <200ms）へ送ってある。**ここでは NO-GO 条件にしない。**

## 3. REAL_MEETING_GATE（最大の製品リスク・最優先）

実 Google Meet で、相手が実際に話す 1 本を通す。1 人では測れない（相手の声が要る）。

```
開始 → 自分が発話 → 相手が発話 → 交互に会話 → Notes / Captions
→ Pause → Resume → Ask Astra → Stop → Library → Source / Audio jump
→ Astra を kill → Recovery
```

記録する（`docs/privacy-egress.md` 末尾の 4 行と同じ形式で追記）:

```
local voice          PASS / FAIL
remote voice         PASS / FAIL      ← マイク経由で相手の声が文字起こしに出るか
system audio         NOT_CAPTURED     ← いまは未接続。繋いだ日に再測定
transcript           PASS / FAIL
speaker attribution  PASS / FAIL
Live Notes           PASS / FAIL
Pause/Resume         PASS / FAIL
Stop/Finalize        PASS / FAIL
Library persistence  PASS / FAIL
Source jump          PASS / FAIL
Recovery             PASS / FAIL
```

**相手の声が録れなかったら**（本人の指示、2026-09-05）: 理念より会議が正しく録れることを優先する。
`.meeting = [.microphone]` に固執せず、「相手の声も記録するには画面収録が要ります」を
**その機能の直前で** purpose-first に求める形にする（起動時一括には戻さない）。
`verify-privacy-egress.sh` は `captureSystemAudio: true` と `.screenRecording` が
**両方**あるときだけそれを PASS にするので、片方だけ入れると gate が落ちる。

## 4. ACCESSIBILITY_GATE（中核 4 本だけ）

全画面総当たりはしない。Full Keyboard Access と VoiceOver の**両方**で 4 本を完走する。
操作手順の詳細は `a11y/RUNBOOK.md` §1（キーボード）と §2（VoiceOver）。

```
A. ⌥Space → Listening → Cancel
B. Meeting start → Notes → Stop
C. Task Running → Confirmation → Edit / Cancel / Execute
D. Library → Meeting → [Source] → transcript / audio
```

```
missing accessible name = 0
unreachable control     = 0
focus lost              = 0
wrong reading order     = 0
keyboard dead end       = 0
core journey completion = 4/4   （FKA と VoiceOver で各 4 本）
```

落ちた要素だけ直す。直したらこの runbook の 1 からやり直し（同じバイナリの原則）。

## 5. LIVE_TCC

**初回許可の状態から**、必要になった瞬間だけ求めることを確かめる。TCC のリセットは本人が行う
（`tccutil` は端末の設定を変えるので、こちらからは実行しない）。

```
microphone / screen recording / input monitoring / calendar / accessibility

起動時に一括で求めない            （PERMISSION_JIT_OK は静的に見ている。ここは実ダイアログで）
求める前に理由が読める
拒否しても回復の道がある
許可した直後にその場で再開する    （カレンダーは「これからの予定」がその場に出る）
```

カレンダーだけは `--selftest calendarlive` がある（結果は `/tmp/astra-calendarlive.txt`）。

## 6. 競合 hands-on（残り 5 型）

既に勝っている 4 型（Confirmation / Meeting Controller / Live Notes / Library-Provenance）は**凍結**、
再検討しない。残りだけ、その面で最強の相手と戦わせる。

| Astra 型 | 相手 |
|---|---|
| Invocation | VoiceOS / Raycast |
| Listening | VoiceOS / Wispr Flow |
| Task Running | VoiceOS / Raycast |
| Workspace | Granola / Notion |
| Recovery | SuperIntern / 最も適切な実 UI |

素材は公開されているものか自分で撮った hands-on を `voiceos/handson` `superintern/handson` などに置き、
`metadata.yaml` に**版と取得日**を書く。判定は既存の盲検規約（`compare/sample22/prompts/` と同じ型、
2 名、観察を先に、棄権可）。判定ルールは単純に:

```
重大敗北 = 0
task discoverability で敗北 = 0
safety / trust で敗北 = 0
明確な競合優位がある型だけ、その型を修正
```

「角丸はこちらが好み」程度では直さない。

## 7. IDEAL_RELEASE_GATE（ここまで全部 PASS で初めて）

```
INVOCATION / REAL_MEETING / ACCESSIBILITY / LIVE_TCC / WORLD_CLASS 9 型
PRIVACY_EGRESS / VERIFY_ALL / GitHub CI / signed app / notarization
SUFeedURL / SUPublicEDKey / Sparkle real appcast / --selftest update / verify-release-artifact
```

`scripts/release-macos.sh` → `verify-release-artifact.sh` → `publish-update.sh` の順。
**公開（`gh release create`）は本人の明示の指示があってから。**
最後に、その release candidate から取扱説明書のスクリーンショットを撮り直し、
配布する `.app` と説明書に写っているものが同一であることまで確かめる。

---

## §2 は署名済み .app で通した（2026-09-05）

`package-macos-app.sh` で作った署名 .app（`com.astra.desktop`、Apple Development、Team 6RR7572ZLU）を
`open --args` で走らせた実測。**この Mac のマイクは既にこのバンドルへ許可済みだったので測れた**
（未許可の端末では TCC ダイアログが出る＝それ自体は §5 の対象）。

```
INVOCATION_AUDIO_TRUTH（signed .app、/tmp/astra-rc/invocation/result.json）
  stateTruth.claimedLiveWhileDeaf        false     取り込み前に「録音中」と名乗らない
  stateTruth.headlineWhileDeaf           ["準備中…"]
  stateTruth.headlineAfterLive           "録音中"
  stateTruth.stuckPreparingAfterLive     false
  listeningTruth.captured                true      Listening が実際にマイクを開く
  listeningTruth.micOpenDuringListening  true
  listeningTruth.firstFrameMs            133ms
  listeningTruth.claimedLiveWhileDeaf    false     取り込み前に「聞いています…」と名乗らない
  listeningTruth.headlineAfterLive       "聞いています…"
  listeningTruth.micClosedAfterCancel    true      Esc でマイクが閉じる
  lossWindowFromSurfaceMs                104ms     記録値（基準ではない）
  → verdict PASS
```

**INVOCATION = COMPLETE**（UI の名乗りと実装状態の一致という完成条件で）。物理の窓 104ms は
`MIC_READY_LATENCY_GATE`（target <200ms）へ送ってある。

途中で見つけて直した欠陥: `package-macos-app.sh` が Sparkle を同梱しておらず、作った .app が
`Library not loaded: @rpath/Sparkle.framework` で**起動即クラッシュ**していた（Sparkle 導入後、
この台本だけ更新されていなかった）。署名 .app が起動しない＝TCC の要る検証が全部できない状態だったので、
`release-macos.sh` と同じ手順で同梱＋内側から署名し、最後に「起動するか」を台本自身が確かめるようにした。

## いま埋まっていない欄（2026-09-05 時点）

```
INVOCATION                      PASS           §2  署名 .app で実測（上）
REAL_MEETING                    NOT_MEASURED   §3  相手のいる実会議が要る
ACCESSIBILITY                   NOT_MEASURED   §4  FKA / VoiceOver を人が操作する
LIVE_TCC                        NOT_MEASURED   §5  TCC リセットは本人が行う
WORLD_CLASS 残り 3 型            NOT_COMPARABLE §6  Listening / Task Running / Recovery は公開素材が無く hands-on が要る
                                                    （Invocation は vs Raycast WIN、Workspace は vs Granola WIN / vs Notion SPLIT、Sample 23）
VERIFY_ALL                      PASS           §0  2026-09-05 07:47 本人のターミナルで VERIFY_ALL_OK
PERCEIVED_SURFACE_CONTINUITY    T1 FAIL        journeys/perceived/（層 B。T1 の中身 fade が「別物」に読まれる。修正は本人の判断）
```

上の NOT_MEASURED / FAIL が残る限り **NO-GO**。「十分良いので出す」という判断はしない。
