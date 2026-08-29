# Astra macOS UI 最終仕様 / Visual Gate（2026-08-29）

実機（署名 `.app` / debug build）を起動して撮影し、**画面を見て**評価・修正した結果を固定する。
「コードにある」ではなく「実機でこう出る」を正とする。

## Golden Screenshot 一覧

`docs/golden-screenshots/` に 9 面を保存。再取得は次のコマンド（実アプリが自分で撮る）:

```bash
apps/astra-macos/.build/debug/AstraMac --selftest shots /tmp/astra-shots
```

| #   | ファイル                      | 画面                   | geometry（実測）                     |
| --- | ----------------------------- | ---------------------- | ------------------------------------ |
| 01  | `01-voice-hud-idle.png`       | Voice HUD idle         | 310×31（tokens: hudWidth/hudHeight） |
| 02  | `02-voice-hud-listening.png`  | Voice HUD listening    | 310×31                               |
| 03  | `03-recording-workspace.png`  | Recording Workspace    | 920×590（workspaceWidth/Height）     |
| 04  | `04-recording-transcript.png` | 文字起こし表示         | 920×590                              |
| 05  | `05-recording-rag.png`        | RAG Drawer 展開        | 920×590                              |
| 06  | `06-main-home.png`            | Main / Home            | 1040×680                             |
| 07  | `07-apps.png`                 | Main / Apps            | 1040×680                             |
| 08  | `08-meeting-detail.png`       | Meeting Detail         | 1040×680                             |
| 09  | `09-permission-denied.png`    | マイク許可なしで録音中 | 920×590                              |

`shots` は撮るだけでなく **geometry と非空白（色数）を検査**する。窓が在るだけでは PASS にしない。
**light / dark の両方**を撮る（`--selftest shots <dir> [dark]`）。dark 版は `docs/golden-screenshots/dark/`。
`scripts/verify-macos-recording.sh` に組み込み済みなので `pnpm verify:all` で毎回走る（light/dark とも）。

### Golden 差分

```bash
apps/astra-macos/.build/debug/AstraMac --selftest golden docs/golden-screenshots /tmp/astra-shots-light
```

撮り直した画面を **committed の golden と画素で**比べる（許容 0.5%、200 点角のグレースケール）。
比べるのは中身が決まっている 7 面のみ:
`01 / 02 / 03 / 04 / 05 / 08 / 09`。
Home は挨拶が時刻で変わり、Apps は接続状態で変わるので入れない
（落ちる理由が「時計が進んだ」になるテストは、次から誰も直さない）。
実測の再撮影差は **0.000%**。dark を fresh として渡すと 97〜99% で落ちることを確認済み（検出力の確認）。

### hover / focus / pressed

```bash
apps/astra-macos/.build/debug/AstraMac --selftest states /tmp/astra-states [dark]
```

Visual Gate はマウスを動かせないので、状態を差し込んで撮り **neutral との画素差**で判定する。
「実装した」ではなく「画面が実際に変わった」を証拠にする。実測（light / dark）:

| 状態    | 見え方                                            | neutral との差 |
| ------- | ------------------------------------------------- | -------------: |
| hover   | 地が `hoverDelta` 濃くなる                        |  4.01% / 3.94% |
| focus   | アクセント色のリング `focusRing`                  |  0.93% / 0.93% |
| pressed | 地が `pressedDelta` 濃く＋`pressedScale` 押し込み |  4.06% / 3.89% |

保存先は `docs/golden-screenshots/states/`（`dark-` 接頭辞が dark）。
0.1% 未満は「実質見えない」として FAIL にする。

### キーボード操作

| 操作                 | 割り当て     |
| -------------------- | ------------ |
| 文字起こし/翻訳/字幕 | ⌘1 / ⌘2 / ⌘3 |
| RAG を開く           | ⌘R           |
| 録音を止める         | ⌘.           |
| 要素間の移動         | Tab / 矢印   |

focus リングは **Tab / 矢印を押してから**出す（`KeyboardNavigation`）。
標準の focus effect は `.focusEffectDisabled()` で切り、リングを自前の 1 本に統一している。

## Task Dock（一つの存在が、大きさと役割を変える）

**窓を足さない。** 状態ごとに別 Panel を出すのをやめ、上辺中央の一枚が姿を変える。

```text
画面上端 ──────────────────────────────  上辺は角丸を付けず、縁に接する
        ┌──────────────────┐            （丸めた瞬間「上に置いたカード」になる）
        │ ● Astra    ⌥ space│            下の 2 角だけ丸い。くびれは作らない
        └──────────────────┘
```

| 状態              | 実寸         | 中身                                                   |
| ----------------- | ------------ | ------------------------------------------------------ |
| 1 Idle / Presence | 156×34       | 点と名前だけ                                           |
| 2 App Context     | 196×34       | `◈ Notion` の 1 行（巨大 popup を出さない）            |
| 2' 展開           | 320×176      | ページ名 + Suggested（そのアプリで実際に頼めること）   |
| 3 Listening       | 420×84       | **発話内容が主役**。小さな波形 + Context Strip         |
| 4 Thinking        | 300×44       | 1 行                                                   |
| 5 Agent           | 480×可変     | 段ごとの進行（chat bubble ではない）。段数で下へ伸びる |
| 6 Confirmation    | 420×168      | **Dock 自身が聞く**（NSAlert も別窓も使わない）        |
| 7 Meeting         | 460×56 / 196 | 既定は 1 行。5 面のうち**開くのは 1 枚だけ**           |
| 8 Full Workspace  | —            | Dock は静かなまま、Workspace が開く                    |

- **top anchor 固定**: `screen.frame.maxY - height`。高さが変わっても上辺は動かず下へ伸びる
- 白基調。`.regularMaterial` に薄い白（dark では薄い黒）を重ね、髪の毛ほどの縁。影は控えめ
- 色は orb だけに持たせる。Context Strip の ✓ は形で伝える（色を増やさない）
- 寸法・余白・時間はすべて `tokens.json` の `voiceHud` / `animation`

### Task Dock の Visual Gate

```bash
apps/astra-macos/.build/debug/AstraMac --selftest dock8 /tmp/astra-dock [dark]
apps/astra-macos/.build/debug/AstraMac --selftest dockanim
```

`dock8` は fixture を並べない。`AstraStateStore` を**実際に遷移させて**撮る
（`requireConfirmation` が Dock を展開し、`startTask` が timeline にし、
`meetingStarted` が会議バーにする）。検査するのは:

- 各状態の実寸が仕様どおり
- **上辺の Y が全状態で同一**（中央から広がっていない）
- **窓が常に 1 枚**（第二 Panel を出していない）
- 中身が入っている（真っ白/真っ黒な板ではない）

`dockanim` は遷移中の window frame を 8ms ごとに拾い、
**その間ずっと上辺 Y が動かない**ことと、幅が滑らかに変わることを実測する
（実測 185–196ms / 上辺の値は 1 種類）。

golden は `docs/golden-screenshots/task-dock/`（light）と `.../dark/`。

## レイアウトの正（tokens）

数値は View に直書きせず `shared/design/tokens.json` → `Metrics` から取る。

| token                          |            値 | 用途                      |
| ------------------------------ | ------------: | ------------------------- |
| `workspaceWidth/Height`        |     920 / 590 | Workspace の面            |
| `notchWidth/Depth/Shoulder`    | 286 / 25 / 30 | 上辺の凹み                |
| `dockWidth/Height`             |      250 / 42 | Task Dock                 |
| `wsGutter`                     |            24 | Workspace 外周            |
| `wsContentTop`                 |            64 | notch 下から本文開始      |
| `wsColumnGap`                  |            20 | 左右列の間                |
| `wsRightColumn`                |           320 | 文字起こし列              |
| `wsRagDrawer`                  |           196 | RAG Drawer 高さ           |
| `wsBottomBar`                  |            44 | 下部バー（hit area 兼用） |
| `hoverDelta` / `pressedDelta`  |   0.06 / 0.11 | hover / pressed の地の差  |
| `pressedScale` / `focusRing`   |      0.97 / 2 | 押し込み / focus リング   |
| `hudWidth/Height/BottomRadius` | 310 / 31 / 17 | Voice HUD                 |

## Recording Workspace の構造

```text
┌──────────── notch + Task Dock ────────────┐
│  左: Hero → AI 操作 → AI 結果 │ 右: 切替 │
│                               │    文字起こし │
│                               │              │
│  下: RAG（閉=バー / 開=この区画だけ伸びる）  │
└───────────────────────────────────────────┘
```

- 絶対配置（`.position`）を使わない。以前は `.position(x:120,y:300)` などで浮かせており、
  **RAG を開くと他カードを切っていた**。いまは下の区画が伸び、上は押し縮められる。
- 切替（文字起こし/翻訳/字幕）は**結果の真上**に置く。以前は画面の左右に離れていた。
- AI 操作はカードを敷かず横一列。左右の視覚的な重さを揃える。
- AI の結果は `AIResultPanel` に出る（以前は**どこにも出ていなかった**）。

## 実機で見つけて直した UI 問題

1. **Voice HUD が見えない**: `screen.frame.maxY` に置いていてメニューバーの裏だった → `visibleFrame`（commit 4acd14f）
2. **RAG を開くと他カードが切れる**: 絶対配置 → 構造化レイアウト
3. **AI の結果が表示されない**: `aiResult` が UI に無かった → `AIResultPanel` 追加
4. **Apps の接続状態が読めない**: 灰色トグルのみ → 接続済み/未接続/設定が必要を**文字＋アイコン**で（色だけに頼らない）
5. **誕生日の予定に「録音を開始」**: 終日イベントを Attention から除外
6. **起動後にアプリへ触れる入口が無い**: `.accessory` 起動で Dock アイコンも
   メニューバーも無く、Main / 設定 / 終了へ到達できなかった（`open --args` は
   起動済みプロセスには渡らないため実質行き止まり）→ メニューバーに status item を追加
   （Astra を開く / 会議を録音・停止 / ショートカットの表示 / 設定 / 終了）
7. **dark で本文が読めない**: 面は固定の白のまま、文字は `.primary`（dark では白）だったので
   白 on 白になっていた（実機の dark 撮影で判明）→ 面・カード・罫線・薄塗りを
   `Color.workspaceSurface(dark)` / `cardSurface` / `hairline` / `subtleFill` に集約し外観へ追従
8. **触っても何も返らない**: hover / focus / pressed が**アプリ全体で 0 箇所**だった。
   静止画では整って見えるが、押せるものが押せると分からない → `AstraControlStyle` に集約し
   tokens（`interaction`）から差分量を取る
9. **窓を開いた瞬間に青い focus リング**: `.focusable(true)` を付けたことで SwiftUI 標準の
   focus effect が出ていた（実機の hover 撮影で判明）。macOS はマウスで開いた直後にリングを見せない
   → `.focusEffectDisabled()` ＋ `KeyboardNavigation`（Tab/矢印で初めて点灯）
10. **左列の下 260pt が空白**: 上詰めのため右の全高カードと釣り合わず構図が上に寄っていた
    → AI 結果が無い間は左列を上下中央に、結果が出たら上詰めへ
11. **夜に「Good morning」**: 挨拶が英語で固定されており、日本語の画面に 1 行だけ英語が混ざり、
    しかも時刻と合っていなかった（18 時台の撮影で判明）→ 時刻から日本語で作る
12. **入力欄に見えて入力できない**: Home の「何を終わらせますか？」は `Text` を箱に入れただけだった
    → 本物の `TextField` にし、Enter で Voice HUD と同じ依頼経路へ。途中と結果もその場に返す
13. **空状態が入力欄の直下に貼り付く**: 下に 400pt の空白が残り「途中で切れた画面」に見えた
    → 残りの高さの中央へ
14. **Apps のカードの縁が dark で消える**: 枠線を `Color.black.opacity(0.08)` で直書きしていた
    → `Color.hairline(dark)`。状態色も `Palette.successLight` 固定 → `Palette.success(dark)`
15. **「設定が必要」だけで何をすべきか分からない**: 止まっている理由を 1 行添える
    （「接続に使う client ID がまだ設定されていません」）
16. **Meeting Detail だけ英語**: SUMMARY / DECISIONS / Related files / audio jump …
    → 画面の言語を日本語へ統一。タブは `Text` の箱で押せなかったので実ボタン＋選択状態に。
    音声リンクは飛ぶ手当てが無いときリンク色で出さない（押して何も起きない状態を作らない）
17. **マイク拒否のまま黙って録り続ける**: 許可が無くても `NSLog` を出して続行していたので、
    画面は「録音中 / 04:21 / 波形」なのに中身は無音——会議が終わってから気づく壊れ方だった
    → `PermissionBanner`（理由＋設定への導線）を出し、見出しを「録音中（音声なし）」、
    波形を平らに、録音ドットを灰色にして**画面が嘘をつかない**ようにする
18. **戻せない操作の確認が 0 箇所**: 録音中に「Astra を終了」を押すと会議が黙って消え、
    Apps の「切断」は一度の誤クリックで繋ぎ直しになった
    → `Confirm.destructive` を 1 か所に置き、`applicationShouldTerminate` と切断に適用。
    既定のボタンは安全側（録音を続ける / やめる）
19. **「RAG Context」と生スコア 0.45**: 何の面か英語で書かれ、点数だけ出ていて
    「AI が何を見ているか」が伝わらなかった → 「AI が見ている資料」＋関連の強さを棒で
20. **Visual Gate が忙しいときだけ落ちる**: 窓の出現を固定待ちしていたため、
    連続実行時に `06/08=撮影不可` で落ちた（テスト側の欠陥）
    → 目当ての寸法の窓が window server に現れるまで待ってから撮る
21. **Main の geometry 固定検査が脆い**: titled window は WM がサイズを詰める → 最小寸法＋内容量で判定（commit 3011d8b）

## Accessibility identifier

`recordingWorkspace` / `toolPalette` / `tool-<id>` / `aiActions` / `ai-<title>` / `aiResult` /
`aiResultClose` / `ragToggle` / `voiceHUD` / `intentBar` / `contextLens` / `workSurface` /
`homeIntentField` / `homeIntentMic` / `homeIntentAnswer` / `meetingTab-<name>` /
`permissionBanner` / `permissionOpenSettings` / `meetingAudioJump` / `stopRecording` / `approvalCard` / `actionReceipt` / `evidenceSummary` / `lineagePanel` / `meetingSurface` /
`meetingArtifact` / `researchResult` / `homeView` / `connector-<app>` / `workspaceShell`

`--selftest axtree` が Main の 4 セクションと Workspace の統合サーフェスを
**アクセシブル要素として**検出することを毎回検査する。

## hit area

小さい字・アイコンでも押せる面を 28〜32pt 確保する（UI/UX 仕様 §16）。
tool セグメント / AI 操作 / RAG トグル / AI 結果の閉じる / Meeting Detail の二次アクションに適用済み。
