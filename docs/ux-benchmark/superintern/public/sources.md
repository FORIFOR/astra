# 出所 — SuperIntern

| ファイル | 場面 | 出所 URL | 取得日 | 版 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `hero-videocall-mock.webp` | hero の背景 | https://super-intern.com/hero/meeting-window.webp | 2026-09-02 | 版の表記なし | **SuperIntern の UI ではない。** ビデオ会議の作り物（「Weekly Sync」）。hero の背景素材 |
| `ai-canvas.webp` | Note + Transcribe + 設定窓 | https://super-intern.com/blog/_shared/en/ai-canvas.webp | 2026-09-02 | v0.14 の記事 | **OFFICIAL_PRODUCT_UI**。実 UI。1280x670 |
| `ai-canvas-live-summary.webp` | AI Canvas のライブ要約 | https://super-intern.com/blog/v0-14update/ai-canvas-live-summary.webp | 2026-09-02 | v0.14 | **OFFICIAL_PRODUCT_UI**。540x480 |
| `control-bar.webp` | Control Bar + 設定 | https://super-intern.com/blog/v0-14update/control-bar.webp | 2026-09-02 | v0.14 | **OFFICIAL_PRODUCT_UI**。1226x790 |
| `hero-videocall-mock.webp` | （参考） | https://super-intern.com/hero/meeting-window.webp | 2026-09-02 | — | **UI ではない**。hero の背景素材 |
| `speaker-diarization.webp` | 話者分離のデモ | https://super-intern.com/en/blog/v0-10update（記事内画像） | 2026-09-02 | v0.10 | **53 コマの動画 webp**。`speaker-diarization.png` は 1 コマ目で、**空の白いパネル**（sample08 / 15 はこれを採点して無効になった）。中身が出るのは 4 コマ目以降 |
| `speaker-diarization-frame30.png` | 話者分離のデモ（30 コマ目） | 同上 | 2026-09-02 | v0.10 | You / Mike / Lisa の 3 行の時間軸と波形。**デモの図で、文字起こしの本文は写っていない**。sample18 の競合側 |

## 公式ページに書いてあること（2026-09-02 取得・本文のみ）

**これは公式が書いている説明であって、製品を触って確かめた事実ではない。**

- 「高精度なリアルタイム文字起こしと議事録を自動作成」
- bot を入れず、PC のマイクとスピーカーから直接録る
- 指示テンプレートで、ノートの構造を決められる
- 会議をまたいだ AI チャット
- 「話者分離」
- Zoom / Google Meet / Microsoft Teams / Slack / Webex
- 多言語会議のリアルタイム翻訳
- 会議のあとのタスク自動化

### 会議中の面

- **「AI キャンバス（会議ノート）」**が「ライブ生成中」として出る
- 「その指示通りの構造で、リアルタイムに埋まっていきます」
- 「停止ボタン」で録音を終える
- 会議のあと、整えた文字起こしが自動で作られる

### 取れた経緯

公式トップの静的素材には UI の絵が無かった（ロゴ・連携先アイコン・顔写真・背景のみ）。
**公式ブログの記事内画像**に実 UI があった。

### 撮られている状態（絵から読めることだけ）

- **Note** と **Transcribe** が**別々の浮遊パネル**として同時に出る。
  それぞれに ✕ と掴む所がある
- Note の中は表（項目・担当・日付・状況）と見出し（Situation / Actions）
- Transcribe は発話が流れる。**話者名は見えない**
- パネルの下端に Control Bar（⋯ ⏸ ⏹）
- 別に設定の窓がある（Instructions / Dictionary / Language / Shortcuts …）
- Control Bar を開くと Stealth mode / Dictionary / Language / Shortcuts /
  Microphone / System Audio

### 重要な但し書き

**撮られた状態に見えないことを、製品に無いと読まない。**
別の状態では出るかもしれない。判定は必ず
「この公開素材のこの状態では見えない」までにする。

### 取れていないもの

- 画面の絵（AI キャンバスの実際の見た目）
- 版
- **会議中に、話者・時刻・出所が項目ごとに出るかどうか**
  公式ページの本文には記述が無い。**無いとは限らない**（書いていないだけかもしれない）
