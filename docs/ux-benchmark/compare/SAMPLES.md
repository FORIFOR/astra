# PUBLIC_COMPETITIVE_DESIGN_GATE — 標本

公式の公開素材だけを使う。**操作していないので、操作の話はしない。**

---

## Sample 01 — Astra vs SuperIntern（会議中の面）

```
Products     Astra（J09 会議中の面） vs SuperIntern（AI Canvas + Transcribe）
Evidence     Official public product UI only
```

### 無効にした回

```
Invalidated run   8-0 Astra
Reason            競合側の画像がマーケティング用の合成図だった
                  （設定窓 ＋ 青い矢印 ＋ 会議 UI の 3 点セット）。
                  Astra 側は単一の製品状態。
                  面の数と窓の数に不公平な偏りが入った。
Action            集計から除外。製品 UI の部分だけを切り出して回し直した。
Found by          Judge 3 が「設定ダイアログが重なっていて複数の窓がある」と
                  書いたので気付いた。**採点者の記述が無ければ見逃していた。**
```

### 有効な回

```
Valid run    Astra 7 / SuperIntern 1

Astra wins
  - information_hierarchy      3/3
  - surface_fragmentation      3/3
  - state_legibility           3/3
  - control_visibility         3/3
  - visual_craft               3/3
  - provenance_visibility      3/3
  - visual_density             2/3（1 引分）

SuperIntern wins
  - screen_occupation          2/3
```

### 負けた項目は隠さない

**`screen_occupation` は競合が上。** 競合は Note と Transcribe の 2 枚の
小さな浮遊パネルで画面の一部だけを使う。Astra は 1080×680 の面を丸ごと開く。
**「一つの面」であることの代償**が、そのまま出ている。

いま見えているのは優劣ではなく**取り引き**:

```
Astra        統合性 ↑   占有面積 ↓（大きい）
SuperIntern  占有面積 ↑（小さい）  分散 ↑
```

**1 組だけで面積を縮めない。** 標本を増やして `screen_occupation` が
負け続けるなら、そのとき初めて Meeting Compact Mode のような案を探す。
One Surface を保ったまま面積だけ適応させる方向で、競合の 2 パネル方式へ
戻す必要は無い。

### この標本の限界

```
- public evidence only            公開素材だけ
- no hands-on interaction         触っていない
- no task success measurement     完遂率は測っていない
- no focus-theft comparison       焦点を奪うかは比べていない
- no interaction-speed comparison 速さは比べていない
- feature not visible in competitor capture != feature absent
  競合の絵に見えないことは、製品に無いことではない
```

---

## これから増やす標本

```
Sample 02  VoiceOS Agent Mode / action
Sample 03  VoiceOS Agent Mode / response
Sample 04  SuperIntern Live Summary
Sample 05  SuperIntern Live Caption
Sample 06  SuperIntern Control Bar
…
Sample 10
```

最終結果は「Astra 何勝」ではなく**軸別の勝率**で出す。
どこに強く、どこに弱いかが分かる形にする。
