# 字幕モードの整理 — 2026-09-11

ユーザーの依頼に合わせ、Dockと録音作業画面の「大きな字幕」を削除した。表示切替は「原文」「翻訳」の2項目。原文のライブ更新・発言者・時刻と、翻訳の言語選択・再試行は維持する。ショートカットは⌘1/⌘2となり、不要な⌘3・ガイド内の案内も削除した。

## 検証

- `swift test --package-path apps/astra-macos`: 93件成功、失敗0。翻訳とAPI重複実行防止の既存回帰テストを含む。
- `--selftest shots`: light/darkそれぞれ16面成功。6面ずつのgoldenを更新。11画像の差分は削除したボタンの文字だけで、lightの会議canvasでは小さな文字描画差分もある。内容・話者・時刻を目視確認し、全画像で既存の0.5%差分閾値以内。
- `--selftest geometry --record`: AXで6状態を取得。旧基準との差は`06-workspace`の`tool-captions`削除だけ。他のコントロールと窓寸法は一致。
- `--selftest occupation`: 7面がtoken上限内。
- `--selftest translation-layout`: 終了コード0、320/720pt・light/dark・処理中/失敗/再試行成功の12枚を生成。翻訳クライアントは注入した合成fixtureで、外部通信なし。
- type literals、用語、UI taste、guide facts、`git diff --check`: 成功。

変更理由は[ROUND.md](../../ux-benchmark/compare/transcript-modes/ROUND.md)、画像比較は[comparison.json](../../golden-screenshots/transcript-modes/comparison.json)。音声認識やモデルに対する追加の課金リクエストは実行していない。

この記録は表示モード削除の検証であり、製品全体の`release=go`再判定ではない。全体ゲート未完了のため、この変更のcommit/pushは行っていない。
