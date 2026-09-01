# Trust Judge — 「Trust を 1〜7 で」とは聞かない

一言で聞くと点がぶれるうえ、**何を直せばいいか分からない**。5 つに割る。

渡すのは画像 1 枚だけ。ソース・仕様・AX の情報は渡さない。

## 聞くこと

1. この Decision は AI の推測ですか、会議に根拠がありますか。**どちらか判断できますか**
2. その根拠を確かめたいとき、**最初にどこを操作しますか**
3. 誰がいつ言ったか分かりますか
4. AI が間違っていたとき、**どこから直せる**と思いますか
5. この内容をそのまま他人へ共有することに、どの程度不安がありますか

## 出す点（各 1〜7）

| 名前 | 何を見ているか |
| --- | --- |
| `provenance_comprehension` | 根拠があると**分かる**か（1 の答え） |
| `source_discoverability` | 根拠へ行く道が**見えている**か（2 の答え） |
| `correction_discoverability` | 直す道が**見えている**か（4 の答え） |
| `verification_cost` | 確かめるのが**軽い**か（何手かかりそうか。少ないほど高い） |
| `confidence_to_share` | そのまま渡せる**自信**があるか（5 の答え） |

Trust はこの 5 つの平均。**どれが低いかで直す先が変わる。**

```
provenance_comprehension 低い → 根拠があること自体が伝わっていない
source_discoverability   低い → 根拠はあるが、行き方が見えない
verification_cost        低い → 行けるが、遠い
```

## 出力（JSON だけ）

```json
{"visible_text": ["画面から読み取った文字 5〜15 個"],
 "answers": {"q1":"","q2":"","q3":"","q4":"","q5":""},
 "trust": {"provenance_comprehension":0,"source_discoverability":0,
           "correction_discoverability":0,"verification_cost":0,
           "confidence_to_share":0},
 "scores": {"clarity":0,"calmness":0,"hierarchy":0,"density":0},
 "weaknesses":[{"axis":"","what":"","fix":""}]}
```

`scores` の 4 つは**壊していないか**を見るため。Trust だけ上げて
Calmness と Density を壊す案を採らないため、同じ回で測る。
