# Accessibility の実測（測るだけ。直すのは数字を見てから）

`AstraMac --selftest a11ynames [out.tsv]` が、各面を実際に出して **自プロセスの AX ツリー**を歩き、
押せる要素ごとに「何と読まれるか」（AXTitle / AXDescription / placeholder / AXValue）を記録する。
Tab は本物の key event を送り、AX の focused element が動いたか、その動きが**画素として**見えたかを記す。
閾値も PASS/FAIL も持たない（測れないときは SKIP / NOT_MEASURED）。`verify-macos-recording.sh` の一覧に
入っているので、`./scripts/verify-all.sh` のたびに走る。

`accessibilityLabel` の数と `Image(systemName:)` の数を比べても名前の有無は分からない
（Button の中身や親から名前が付く）。だから実 AX で読む。

## 2026-09-04 の実測（`2026-09-04-a11ynames.tsv`、macOS 26.6.2、キーボードナビゲーション OFF）

| 面 | 押せる要素 | 名前なし | 英語だけの名前 |
|---|---|---|---|
| dock idle / listening | 0 | 0 | 0 |
| dock agent / confirmation / meeting | 2 / 4 / 5 | 0 | 1（Ask Astra） |
| workspace | 17 | 0 | 2（Gmail / Drive＝製品名） |
| main home | 15 | 0 | 3 |
| main tasks / meetings / library / agents / plugins | 6 / 9 / 6 / 6 / 10 | 0 | 3 |
| main meeting-detail | 22 | 0 | 5（[1][2][3] の出典ボタンを含む） |
| settings | 6 | 0 | 3（Compact / Comfortable / Large） |

- **icon-only のボタンには名前が付いている**（一時停止・キャプション・スキャン・さらに表示・マイク・閉じる・下に移動）。
  「名前なし」0 は、閉じる/縮小/拡大ボタンとスクロールバーの矢印（subrole から名前が付く）を除いた数。
- **録音の Accessible Name**: 録音中の Dock / Workspace に「録音を止める」がある（`A11Y_RECORDING found=true`）。
- 記録のみ（直していない）:
  - Main の右上ボタンの名前が **`sidebar.trailing`**（SF Symbol 名がそのまま読まれる。`toggleActivity`）。
  - AppKit 由来の **Hide Sidebar** と、Settings の密度 **Compact / Comfortable / Large** は英語。
  - Settings で 5 つの許可の「許可を求める」が押せる要素として出ていない——この環境では全部許可済みで
    ボタンが無いため。未許可の環境では未測定。
- **Tab**（キーボードナビゲーション OFF の既定）:
  - main-home: 入力欄 → （名前の無い AXGroup で 4 回止まる）→ Sidebar → 入力欄、の 7 回周期。
    動いた 6 回はすべて画素で見えた（visible=6 / invisible=0）。
  - workspace: 最初の 7 回は focused element が AXGroup のまま動かず、8 回目で「この会議について聞く」へ。
  - settings: 14 回押しても focused element が AXWindow から動かない（入力欄も一覧も無い面なので、
    OFF では Tab で止まる先が無い）。
  - キーボードナビゲーション ON のときは **未測定**（OS 設定を検査が変えない）。
- VoiceOver の実読み上げは未測定（AX 名の記録まで）。
