# GUIDED_SETUP_GATE（2026-09-07）— UI_FROZEN = YES

macOS の権限設定を、右下の Astra アバターが System Settings の対象までハイライトと吹き出しで案内する。
座標は OS API + Accessibility API + 状態機械で決める（画像認識・座標推定・固定座標 0）。人はクリックも判定もしない。

| 測定器                                                   | 何を測るか                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swift test`（GuidedSetup 35 tests）                     | 状態遷移、granted 自動遷移、denied/notDetermined、selector 優先順位、未発見 fallback、座標変換、clamp、mouse を奪わない、終了で解放                             |
| `AstraMac --selftest guidedsetup --simulate-not-granted` | 実 System Settings、実 AX、権限は変えない。対象の特定、CGEvent の実ドラッグへの追従、窓 0 / 監視 0                                                              |
| `AstraMac --selftest guidedshots`（Atlas）               | 8 面を RC に描かせて撮る。GUIDED_SETUP_GEOMETRY: highlight ⊇ target、bubble ∩ toggle = ∅、bubble ∩ − = ∅、bubble ⊂ visibleFrame、未発見時に highlight/callout 0 |
| `scripts/ui-atlas/review-blind.sh`（ASTRA_JUDGE_ONLY）   | Astra が描いた面だけを 3 model が盲検（合成 3 面は `blind_review: false`、文脈証拠）                                                                            |

## 実機で分かったこと（macOS 15 日本語）

- 一覧の行のスイッチは title が空で `AXCheckBox/AXSwitch`、identifier が `<アプリ名>_Toggle`。名前は隣の静的テキストの value。
- 一覧は段階的に描かれる（先に「+」だけ）。行が出たら取り直す。
- 窓のドラッグは `AXWindowMoved` ではなく `AXUIElementDestroyed` / `AXFocusedUIElementChanged` の連続で届く（80ms で coalesce）。
- スイッチがオンでも許可が返らないことがある（画面収録は再起動待ち）。そのときは「オンにしてください」と言わず「再起動すると使えます」。

## 盲検で直したもの（6 round、docs/ui-atlas/review/_-new, supremacy/_-new）

1. 「+」の横に置いた吹き出しが隣の「−」を隠した → 対象の種類で置き場所を決める（行 = 行の中、+ = 下）。幾何 gate 化。
2. 「1 つ設定してください」は何を直すか言っていない → 1 行目 = 状態（「画面収録が未許可です」）、2 行目 = すること。
3. 「設定できました ✓」は丸の ✓ と二重で、OCR が「く」と読み judge が全員無効 → 文から記号を外し、何を設定できたかを言う。
4. × がアバターの縁に重なり帰属が曖昧 → × と操作子（「システム設定を開く」「もう一度開く」）は吹き出しの中。
5. 吹き出しが行の名前と別名（Astra / AstraDbg）で呼んだ → 見つけた行の名前で言う。
6. 大きな丸に「!」を描くと飾りに見えた → 丸は Astra の印だけ、状態は輪の色と吹き出しの記号。
7. 吹き出しに尾が無く指し先が繋がらない → `CalloutBubbleShape` の尾が対象（またはアバター）を指す。

## 環境に由来し、Astra では直せないもの

- この Mac の TCC 一覧には dev バンドル「AstraDbg」と第三者アプリ（「2.1.260」等）が並ぶ。judge はそれを欠陥と読む。
  合成 3 面を盲検から外し、幾何 gate と切り出し面（target-highlighted）で Astra の画素だけを見る。専用のテストアカウント
  （`scripts/reality/run-unattended-verify.sh`、AUTOMATION_MISSING）でまっさらな一覧を撮るのが本当の直し方。

## 最終（RC 85b8333）

本人の設計判断で独立したアバターの丸を外し、署名はカード内の小さな mark に降格（System Settings = 主役、対象行 = 操作対象、
callout = ガイド、署名 = CTA より弱い階層）。差分 8 面だけ撮り直して再監査した:

| 判定                                            | 結果                                       |
| ----------------------------------------------- | ------------------------------------------ |
| VISUAL_IDEAL_GATE（blind、Astra が描いた 5 面） | PASS — KEEP 5 / FIX_CANDIDATE 0 / NEE 0    |
| VISUAL_SUPREMACY(blind)                         | PASS — BELOW_BAR 0 / NEE 0 / COMPETITIVE 5 |
| GUIDED_SETUP_GEOMETRY                           | PASS                                       |
| focus theft / extra window                      | 0                                          |
| UI_ATLAS_GATE（72/72）/ PIXEL_REGRESSION        | PASS / PASS                                |

**VISUAL_SUPREMACY_FINAL = PASS、UI_FROZEN = YES。** 以後 Guided Setup と Screenshot Context の UI は回帰が出たときだけ触る。
