# 会議準備の出所と開始操作（2026-09-09）

reference : Apple HIG Disclosure controls — https://developer.apple.com/design/human-interface-guidelines/disclosure-controls — 詳細は必要なときに同じ面で開く（2026-09-09確認）。
hypothesis: 今日確認する質問と未解決事項を先に置き、履歴を折り畳み、出所の件数から実際の文書名・抜粋へ進めれば、準備時の優先順位と根拠が分かる。
measured  : 現在は4節を一度に展開。本文14pt、見出し11pt、節間8pt、左右18pt。出所は件数のみ。開始ラベル「会議を始める」は録音ボタンとの違いが不明（独立3モデル一致）。
candidates: A=現状4節展開・件数のみ / B=質問と未解決の2節+履歴の開閉・出所詳細・「この予定を録音」 / C=4節展開を維持して出所詳細・開始名のみ変更。既存token寸法は全候補同一。
gate      : Bのshape/geometry/occupation/type lint→実画面を用いた独立レビュー→light/dark golden取得。意図外差分があれば採用しない。

## 結果

shape・occupation・geometry・type lint 合格。light/dark の実画面と6状態のgeometryを保存。
独立評価は B=KEEP 1 / FIX 2、A=KEEP 1 / FIX 2。全員一致の改善とは扱わない。
出所がただの件数だった機能欠落と、録音開始の曖昧な名称を修正できたためBを採用。
質問と未解決の順は評価が分かれた。下部はScrollViewの途中で、切れたカードはスクロールで読める。
折り畳みの操作後を画像だけで確認できないという指摘は残るため、実操作検証を別途要する。
原回答: dist/release-validation/meeting-brief-fix/review。VERIFY_ALL完了と配布版での再検証は別記録。
