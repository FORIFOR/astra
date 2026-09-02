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

---

## Sample 02〜05

```
Sample 01  SuperIntern 会議中の面      Astra 7 / 競合 1   Judge 3
Sample 02  VoiceOS Agent Mode / Gmail  Astra 1 / 競合 4   Judge 2  ← 負け
Sample 03  VoiceOS Agent Mode / Slack  Astra 2 / 競合 5   Judge 2  ← 負け
Sample 04  SuperIntern ライブ要約      Astra 7 / 競合 0   Judge 2
Sample 05  SuperIntern 文字起こし検索  Astra 5 / 競合 2   Judge 2
```

## 軸別の勝率（標本 5 組）

```
information_hierarchy    3/5   ■■■□□
surface_fragmentation    3/5   ■■■□·
screen_occupation        2/5   ■■□□·
state_legibility         4/5   ■■■■·
control_visibility       3/5   ■■■□·
visual_density           2/5   ■■□□·
visual_craft             2/5   ■■□□□
provenance_visibility    3/5   ■■■□·
```

## 1 組では見えなかったこと

**Sample 01 だけなら「Astra 7-1 で強い」だった。5 組にすると別の絵が出た。**

```
対 SuperIntern（会議の面）  Astra 7-1, 7-0, 5-2   → 強い
対 VoiceOS（確認カード）    Astra 1-4, 2-5        → 弱い
```

相手が変わると結果が反転する。Judge の弁が理由を言っている:

> 「6C60（VoiceOS）は一つの用事のための小さな確認で、単純さと階層が優れている。
>  C5AB（Astra）は同時に多くのパネルを持つアプリ全体の画面」
> 「43B9（VoiceOS）は送る前の確認として、出所のアプリ・宛先・本文・実行と取消が
>  はっきりしている」

**比べているものが違う。** Astra は会議の作業面、VoiceOS は 1 つの用事の確認カード。
同じ「AI の面」でも、担っている役割が別。

### ここから言えること

- 会議の面としては、公開素材で見るかぎり Astra が上（3 組とも）
- **1 つの用事を確認させる場面では、Astra は VoiceOS に負けている**
  Astra には「これを送りますか」に相当する、小さく閉じた確認の面が無い
- `visual_craft` が 2/5 まで落ちた。VoiceOS の確認カードの造形が効いている

### 直す前に

標本 5 組はまだ少ない。`screen_occupation` も `visual_craft` も、
**相手が誰かで決まっている**可能性がある。10 組まで増やしてから判断する。

## 限界（全標本に共通）

```
- public evidence only            公開素材だけ
- no hands-on interaction         触っていない
- no task success measurement     完遂率は測っていない
- no focus-theft comparison       焦点を奪うかは比べていない
- no interaction-speed comparison 速さは比べていない
- feature not visible in competitor capture != feature absent
```


---

# 標本 8 組・型 6 種（instance は平均して 1 票）

```
Sample 01  live_notes              SuperIntern 会議中の面     Astra 7 / 競合 1
Sample 04  live_notes              SuperIntern ライブ要約     Astra 7 / 競合 0
Sample 05  captions                SuperIntern 文字起こし検索 Astra 5 / 競合 2
Sample 02  action_confirmation     VoiceOS Gmail 確認         Astra 1 / 競合 4
Sample 03  action_confirmation     VoiceOS Slack 確認         Astra 2 / 競合 5
Sample 06  meeting_controller      SuperIntern Control Bar    Astra 5 / 競合 2
Sample 07  post_meeting            SuperIntern フォローアップ Astra 4 / 競合 2
Sample 08  transcript_attribution  SuperIntern 話者分離       Astra 6 / 競合 1
```

## 軸別の勝率（型 6 種）

```
state_legibility         6/6   ■■■■■■
information_hierarchy    5/6   ■■■■■□
control_visibility       5/6   ■■■■■□
provenance_visibility    4/6   ■■■■□□
visual_density           3/6   ■■■□□·
screen_occupation        2/6   ■■□□□·
visual_craft             2/6   ■■□□□·
surface_fragmentation    1/6   ■□····
```

## 型で揃えたら、弱点の場所が変わった

標本 5 組（画面どうし）のときと比べると:

```
                        画面どうし  型どうし
surface_fragmentation      3/5  →   1/6   ← 大きく下がった
state_legibility           4/5  →   6/6
information_hierarchy      3/5  →   5/6
control_visibility         3/5  →   5/6
```

**`surface_fragmentation` が 1/6 まで落ちた。** 画面全体どうしを比べていたときは
Astra が勝っていたが、**同じ型の小さな面どうしで比べると、ほとんど引き分けか負け**。

Astra の強みは「大きな面にまとめている」ことであって、
**小さな面そのものの作りではない**、と読める。

## 強いところ・弱いところ

```
強い（型を揃えても勝つ）
  state_legibility        6/6   いま何をしているかが読める
  information_hierarchy   5/6   何が大事かが分かる
  control_visibility      5/6   止める・進める道が見える
  provenance_visibility   4/6   出所が見える

弱い（型を揃えると負ける）
  surface_fragmentation   1/6
  screen_occupation       2/6
  visual_craft            2/6
```

## action_confirmation の行について

上の表の `action_confirmation` は、**別の型の面をぶつけた結果**であり、
型どうしの比較にはなっていない。Astra に対応する面が存在しないため。

```
MISSING_ARCHETYPE: ACTION_CONFIRMATION
```

これは「負けた」ではなく「**無い**」。数字は参考値として残すが、
勝率の解釈には使わない。
