# 何をどう言ってよいか

**根拠のない言葉を使わない。** 3 段階に分ける。

| 言ってよいこと | 必要な根拠 |
| --- | --- |
| **「高品質な UI である」** | QUALITATIVE_UI_GATE 合格。3 人が R01〜R10 を実施し、全軸が床を超える |
| **「公開素材で見るかぎり、この点は Astra のほうが良い」** | 公開素材あり。**画面に写るものだけ**（階層・Density・占有率・空状態・Confirmation 等） |
| **「設計上、競合より優れている」** | 専門家が 3 製品を並べて評価し、Astra が上 |
| **「UX として競合より優れている」** | 実利用者が 3 製品を触って比較し、Astra が上 |

上の段を満たさずに下の段を言わない。逆も言わない
（実利用者評価があっても、それは「設計上」の証明にはならない）。

## いま言えること

```
VISUAL_GATE       PASS      造形が崩れていない（2pt / golden / density）
FUNCTIONAL_GATE   PASS      動く（verify:all / 配布物 47 ゲート）
QUALITATIVE_UI_GATE UNSCORED  レビュアー 0/3 人
COMPETITIVE_GATE    UNDETERMINED  競合素材 0 件
```

したがって、いま言えるのは
**「Astra 自身の品質の床は上がった」**までで、
「高品質な UI である」も、まだ言えない。

## 言ってはいけない例

- 「競合より優れています」← 競合を測っていない
- 「UI が綺麗です」← 何を見て言ったのか分からない
- Qualitative の点数を**自分で付けて**「合格しました」← 採点は人がする
- 公開素材を見て「VoiceOS より操作が速い」「SuperIntern より邪魔にならない」
  ← 公式素材は最良の撮り直し。速度・焦点・成功率は実機でしか出ない
  （`EVIDENCE.md`）
- 「もう素材が無いので進められない」← 公開素材で進む段（Level 1）がある

## 勝つべき領域（全部で勝つ必要は無い）

写しを足しても最も優れた UI にはならない。**どこで勝つか**を決めておく。

| 相手 | 勝つべき領域 |
| --- | --- |
| VoiceOS | Screen context / Voice → action / Task visibility / Context visibility / Agent control / 長く走る仕事 |
| SuperIntern | 会議の開始 / Live Canvas / AI とのやり取り / 出所 / 訂正 / 会議 → 行動 |
| Astra 固有 | One Surface の連続性・Voice+Screen+Meeting+Agent の統合・出所・音声/原文への移動・取り消しと訂正・Calmness |
