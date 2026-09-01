# 評価器を先に試験する — HARNESS_VALIDITY_GATE

**Astra を採点する前に、採点する側を採点する。**

7 周回して分かったのは、自動評価が挙げた「欠陥」13 件のうち 10 件が
検査側の不備だったこと（約 77%）。この率のまま自動修正を回すと、
存在しない欠陥を直しにいく。

```
        ┌─ known-good  正しいと分かっている絵
評価器 ─┼─ known-bad   壊れていると分かっている絵
        └─ edge        状態で答えが変わる絵
                ↓
      HARNESS_VALIDITY_GATE
                ↓
             PASS のものだけ
                ↓
          Astra を採点してよい
```

## 通過の条件

```
fixture の正答率   >= 95%
false positive     <= 5%    正しいものを「壊れている」と言わない
false negative     <= 10%   壊れているものを見逃さない
```

満たした軸だけ `AUTO_FIX_ELIGIBLE = true`。
満たさない軸は `OBSERVATION_ONLY`——**見るだけで、コードを変えない。**

## 置き方

```
fixtures/<軸>/good-*.png    こうあるべき
fixtures/<軸>/bad-*.png     こうなってはいけない
fixtures/<軸>/edge-*.png    状態で答えが変わる（expected.json に条件を書く）
fixtures/<軸>/expected.json 各ファイルの正解
```

fixture は**実際の Astra から作る**。手描きの絵で試験しても、
本物を採点したときに同じ判断をする保証が無い。
