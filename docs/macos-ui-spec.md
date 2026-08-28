# Astra macOS UI 最終仕様 / Visual Gate（2026-08-29）

実機（署名 `.app` / debug build）を起動して撮影し、**画面を見て**評価・修正した結果を固定する。
「コードにある」ではなく「実機でこう出る」を正とする。

## Golden Screenshot 一覧

`docs/golden-screenshots/` に 8 面を保存。再取得は次のコマンド（実アプリが自分で撮る）:

```bash
apps/astra-macos/.build/debug/AstraMac --selftest shots /tmp/astra-shots
```

| #   | ファイル                      | 画面                | geometry（実測）                     |
| --- | ----------------------------- | ------------------- | ------------------------------------ |
| 01  | `01-voice-hud-idle.png`       | Voice HUD idle      | 310×31（tokens: hudWidth/hudHeight） |
| 02  | `02-voice-hud-listening.png`  | Voice HUD listening | 310×31                               |
| 03  | `03-recording-workspace.png`  | Recording Workspace | 920×590（workspaceWidth/Height）     |
| 04  | `04-recording-transcript.png` | 文字起こし表示      | 920×590                              |
| 05  | `05-recording-rag.png`        | RAG Drawer 展開     | 920×590                              |
| 06  | `06-main-home.png`            | Main / Home         | 1040×680                             |
| 07  | `07-apps.png`                 | Main / Apps         | 1040×680                             |
| 08  | `08-meeting-detail.png`       | Meeting Detail      | 1040×680                             |

`shots` は撮るだけでなく **geometry と非空白（色数）を検査**する。窓が在るだけでは PASS にしない。
`scripts/verify-macos-recording.sh` に組み込み済みなので `pnpm verify:all` で毎回走る。

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
6. **Main の geometry 固定検査が脆い**: titled window は WM がサイズを詰める → 最小寸法＋内容量で判定（commit 3011d8b）

## Accessibility identifier

`recordingWorkspace` / `toolPalette` / `tool-<id>` / `aiActions` / `ai-<title>` / `aiResult` /
`aiResultClose` / `ragToggle` / `voiceHUD` / `intentBar` / `contextLens` / `workSurface` /
`approvalCard` / `actionReceipt` / `evidenceSummary` / `lineagePanel` / `meetingSurface` /
`meetingArtifact` / `researchResult` / `homeView` / `connector-<app>` / `workspaceShell`

`--selftest axtree` が Main の 4 セクションと Workspace の統合サーフェスを
**アクセシブル要素として**検出することを毎回検査する。

## hit area

小さい字・アイコンでも押せる面を 28〜32pt 確保する（UI/UX 仕様 §16）。
tool セグメント / AI 操作 / RAG トグル / AI 結果の閉じる / Meeting Detail の二次アクションに適用済み。
