# Accessibility の残り 2 つを人が測る手順（KEYBOARD_TRAVERSAL / VOICEOVER）

検査は OS の設定を変えない（本人の方針）。この 2 つは **専用ユーザーか VM** で、次の順に。
どちらも「直す」前の測定。閾値は持たない。

## 0. 準備

```
cd ~/Projects/astra
swift build --package-path apps/astra-macos
BIN=apps/astra-macos/.build/debug/AstraMac
```

## 1. KEYBOARD_TRAVERSAL（キーボードナビゲーション ON）

1. システム設定 → キーボード → **キーボードナビゲーション** を ON。
2. `"$BIN" --selftest a11ynames docs/ux-benchmark/a11y/$(date +%F)-a11ynames-fka-on.tsv`
3. TSV の `A11Y_ENV` が `fullKeyboardAccess=true` になっていることを確かめる（false なら設定が効いていない）。
4. 見るところ: `A11Y_TAB` の各面で
   - `moved=true` の回数（OFF のときは main-home 6 / workspace 2 / settings 0）
   - `visible=no` なのに `moved=true` の行（**動いたのに見えない** = focus ring が描かれていない。記録する）
   - 名前の無い `AXGroup` で止まる回数（OFF のときは main-home で 4 回）
5. 終わったら設定を戻す。

## 2. VOICEOVER（実読み上げ）

自動化しない（VoiceOver の起動は OS 設定の変更）。⌘F5 で ON にして、`2026-09-04-a11ynames-4tab.tsv` の
`A11Y_CONTROL` の `name=` が**そのまま読まれるか**を面ごとに聞く。

| 面 | 出し方 | 聞くもの |
|---|---|---|
| Main Home | メニュー → 「Astra を開く」 | 「何を終わらせますか？」入力欄、「録音を始める」、Sidebar の Home / Work / Library / Apps |
| Work / Library / Apps | Sidebar で移る | chip「Tasks / Agents」「Meetings / Files」「Plugins / Connectors」が **ボタン** として読まれる |
| 会議詳細 | Library → Meetings → 1 件 | 「[1]」「[2]」の出典ボタン（英語の名前のまま。記録） |
| Dock 録音中 | 会議を録る | 「録音を止める」が読まれる（`A11Y_RECORDING found=true` と一致するか） |
| Settings | メニュー → 設定 | 「許可を求める」（未許可の環境でだけ出る）、密度 Compact / Comfortable / Large（英語。記録） |

記録の形（この dir に `YYYY-MM-DD-voiceover.md`）:

```
VOICEOVER  <面>  <要素>  読まれた文字列  一致=yes/no  備考
```

「読まれない」「別の名前で読まれる」だけを直す候補にする。英語名は本人が決めるまで記録のみ。
