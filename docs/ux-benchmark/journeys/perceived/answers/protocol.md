# PERCEIVED_SURFACE_CONTINUITY — 盲検の規約と検証の規則

- 判定者は新規の subagent（opus / sonnet / haiku / fable）。prompt と 5 枚の画像だけを開く。
- 5 枚 = 本物 2 本（T1 meeting→notes、T2 notes→workspace、`surfacemotion` の実 frame から 8 コマ）
  + 答えの決まった fixture 3 本（F-same / F-diff / F-jump、PIL で描いた合成）。ID は乱数、順は `order.json`。
- **判定者の検証（fixture validation）**: 集計に入れるのは次を全部満たす判定者だけ。
  1. F-same: feel = continuous かつ same_surface ≠ different
  2. F-diff: feel = switched かつ same_surface ≠ same
  3. F-jump: feel = switched（same_surface は different / cannot tell のどちらでもよい。途中のコマが無いので絵からは決められない）
  4. 観察に、画像に無い文字を書いていない
  この規則は j1 の結果を見た後に文章化した（j1 が F-jump を cannot tell と答えたため、
  「feel を主・same_surface の極性を副」と決めた）。j2 以降には同じ規則をそのまま当てる。
- **集計**: 有効な判定者の feel を T1 / T2 ごとに数える。全員 continuous で PASS、割れたら SPLIT、
  全員 switched で FAIL。SPLIT / FAIL は Evidence B（欠陥の信号）として層 C の観察と突き合わせる。
- 本物 T2 は「1 枚目が残ったまま 2 枚目が開く」設計なので、feel の二択（広がった / 切り替わった）に
  収まりにくい。T2 は second_surface = yes-first-stays と top_edge = fixed を主に見る。
