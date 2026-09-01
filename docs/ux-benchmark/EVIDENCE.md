# 素材の格 — 公開素材と実機素材を混ぜない

競合の素材には**二つの格**がある。混ぜると、公式サイトの綺麗な 1 枚から
「Astra のほうが速い」を導いてしまう。

```
public/    公式が出している素材（サイト・動画・配布物のスクリーンショット）
handson/   自分で動かして撮った素材（実機）
```

## public から**言ってよいこと**

画面に写っているものだけ。

| 比べられる | なぜ |
| --- | --- |
| 情報階層 | 1 枚に何がどの大きさで出ているかは写る |
| Density（地の割合） | 同じ |
| Surface 設計（窓か、重ねか、常駐か） | 同じ |
| 会議中の画面占有率 | 同じ |
| 状態の見え方（listening/thinking/executing の描き分け） | 同じ |
| Action visibility（何をしたかが出ているか） | 同じ |
| 空状態の扱い | 同じ |
| Confirmation（確認 UI の有無と形） | 同じ |
| Canvas 構成 | 同じ |

## public から**言ってはいけないこと**

| 出してはいけない | なぜ |
| --- | --- |
| interaction speed / time-on-task | 公式素材は最良の撮り直し。実際の所要は写らない |
| focus theft | 前面を奪ったかは 1 枚では分からない |
| task success | 完遂したかは動かさないと分からない |
| 操作数 | 編集された動画では数えられない |
| first-run success | 初回の権限や失敗は公式素材に出ない |

`scripts/ux-benchmark-report.sh` はこの区別を機械で守る。
`public/` しか無い製品の速度・焦点・成功率の欄は `推定不可` になり、
SUPERIOR_GATE を通さない。

## 置き方

```
docs/ux-benchmark/<製品>/public/
  <場面>.png|mp4
  sources.md          ← 出所。URL・取得日・版・撮影条件
docs/ux-benchmark/<製品>/handson/
  <場面>.png|mp4
  metadata.yaml       ← 版・OS・解像度・サインイン状態
```

**sources.md の無い public 素材は数えない。** どこから来たか分からない画像は、
比較の根拠にならない（版が違えば別の製品である）。
