# ポインタについて測れること・測れないこと

物理クリックがこの環境では届かない（`blind.sh selfcheck` が毎回確かめる）。
代わりに **Vision で発見し、AX で押す**。発見は絵、実行だけ AX。

```
screenshot → Blind が座標を決める → AXUIElementCopyElementAtPosition
          → kAXPressAction があれば AXUIElementPerformAction → 次の screenshot
```

**Blind へ AX の情報を返さない。** 役割・説明・識別子を返すと、絵で気付けない
ボタンまで見つけられてしまい、発見性の検査が壊れる。返すのは
`PRESSED` / `NOT_PRESSABLE` / `NOTHING_THERE` の 3 つだけ。

## 段階的な代替

```
1. AX の意味的な押下      ← 本線（動くことを確認済み）
2. XCUIAutomation         ← unavailable（下記）
3. 鍵盤                   ← 併用
```

`artifacts/ux/capability/xcui.json`: この repo は Swift Package で
`.xcodeproj` が無く、XCUITest の標的を作れない。**以後くり返し試さない。**

## 分けて記録する

| 項目 | 意味 |
| --- | --- |
| `visual_target_found` | 絵から正しい対象を選べたか（UI の良し悪し） |
| `semantic_activation_success` | AX で押せたか（仕掛けの話） |
| `result_state_correct` | 押した結果、目的へ近づいたか |

混ぜない。`Discovery PASS / Activation FAIL` は **UI の問題ではない**。
`Discovery FAIL / Activation PASS` はボタンは動くが **UI が悪い**。

## POINTER_PHYSICAL_METRICS = NOT_MEASURED

以下は AX では代替できない。**推定して点を作らない。**

- 実際の当たり判定（pixel 単位）
- hover で気付けるか
- drag の感触
- ポインタの加速
- 物理的な移動距離
- 小さい的の狙いにくさ

ただし**寸法から取れる proxy** はある（Fitts の法則の近似）:
的の幅・高さ、的どうしの間隔、重なり。`scripts/ux-auto/a11y.py` が測る。

## 採点（CLICK_DISCOVERY_SCORE）

```
最初に選んだ対象が正しい        +3
2 つ目までに正しい              +2
3 つ目以降で正しい              +1
見えている別のものを選んだ      -2
絵からは見つけられなかった      -3
AX の情報が無いと見つからない   FAIL（検査の設計が壊れている）
```
