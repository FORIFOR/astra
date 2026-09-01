# 自律 UX 最適化ループ

**「コードを変更した」で終わりにしない。** 前後の絵・動画・数値・Judge の出力・
採否の理由を残して、初めて 1 周が終わる。

```
全部測る
   ↓
最も低い軸を 1 つ選ぶ          ← auto-gate.py が順位を出す
   ↓
案を最大 3 つ作る（A / B / C）
   ↓
それぞれ build → 同じ Journey を再実行 → 同じ Judge で採点
   ↓
最も高い案だけ残す
   ↓
regression（pnpm verify:all）
   ↓
commit
   ↓
繰り返す
```

## 採否の規則（これを満たさなければ revert）

```
狙った軸        >= +0.25
Critical の悪化 >  -0.15 は禁止（1 つでも該当したら不採用）
VERIFY_ALL_OK
Journey の regression なし
```

**1 つ上がって 1 つ下がったものを「改善した」と言わない。**
Clarity +0.7 / Calmness -1.1 は不採用。

## 案の作り方

同じ問題に対して**違う方向**の案を出す。似た 3 案は 1 案と同じ。

```
例) J05 の Clarity が低い
  A  会議の素性を上へ動かす（位置）
  B  「聞いています」を強く出す（強調）
  C  待っている状態を明示する（言葉を足す）
```

## 1 周ぶんの証拠（`artifacts/ux/<J>/<iter>/`）

```
01-*.png        各段階の絵
frames/         0.25 秒ごと（動きは絵に写らない）
window.mp4      窓だけの録画。**画面全体は残さない**（利用者の私物が写る）
result.json     機械計測（窓・焦点・所要）
ocr/            画面に写っていた文字。Judge の作り話を弾く照合に使う
judge-*.json    Judge の出力（実装を見ていない）
scores.json     中央値とばらつき
decision.json   採否と、その理由
```

## 停止条件

```
UX_LOCAL_OPTIMUM_REACHED
  AUTO_QUALITATIVE_GATE = PASS
  全 Golden Journey >= 6.0（Critical は >= 6.3）
  PUBLIC_COMPETITIVE の勝率 >= 70%
  3 周続けて改善幅 < 0.1
  VERIFY_ALL_OK
```

無限に UI をいじらないための線。ここに達したら止める。

## 言ってよいことの上限

このループで到達できるのは:

```
✅ 「自動 UX 評価において高品質」
✅ 「公開情報で見るかぎり、この点は競合より良い」
❌ 「人が実際に VoiceOS より好んだ」  ← 人がいないと証明できない
```

最後の 1 行だけは、どれだけ自動化しても埋まらない。
