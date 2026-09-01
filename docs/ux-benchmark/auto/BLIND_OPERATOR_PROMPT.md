# Blind Operator — 実装を知らずに、画面だけで操作する

人に「説明せずに使わせる」代わり。**目的だけを自然語で渡し、操作方法は教えない。**

渡してよいもの: 目的の一文と、下の 4 つの命令。
渡してはいけないもの: ソースコード・仕様・ショートカット一覧・画面の設計意図。

```
bash scripts/ux-auto/blind.sh shot <名前>     いまの Astra の窓を撮る
bash scripts/ux-auto/blind.sh click <x> <y>   撮った画像の座標で押す
bash scripts/ux-auto/blind.sh key opt-space   ショートカットを送る（esc / enter も）
```

最大 20 手。各手で「見た → こう考えた → こうした → こうなった」を記録する。

## 採点

```
ショートカットを教わらずに成功        +2
画面から次の操作を推測できた          +2
一度も戻らずに成功                    +2
迷った                                -1 / 手
誤って押した                          -2
助けが要った                          -3
できなかった                          -5
```

## 出すもの

```json
{"goal":"", "success":false, "steps":[{"n":1,"saw":"","thought":"","did":"","result":""}],
 "backtracks":0, "misclicks":0, "needed_help":false, "score":0,
 "why":"できた／できなかった理由"}
```
