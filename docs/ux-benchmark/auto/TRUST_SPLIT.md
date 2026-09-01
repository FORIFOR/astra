# Trust を 2 つに割る

「このUIをどれくらい信頼できますか」を 7 段階で聞くのをやめた。
**採点者に心理状態を直接当てさせない。**

## 1. Holistic Trust — 測れない

「この AI に日常の仕事を任せられるか」。会話の正確さ、失敗の経験、
復旧、時間の経過が要る。**静止画 1 枚では原理的に決まらない。**

```
HOLISTIC_TRUST = NOT_MEASURED
Evidence = D
AUTO_FIX_ELIGIBLE = false
```

総合ゲートから**外す**。「人が見るまで BLOCK」ではなく、
自動では測れないものとして扱う。

## 2. Trust Affordance — 測れる

画面に何が在るかは、見れば分かる。7 段階ではなく **YES / NO** で聞く。

```
provenance_visibility        誰が言ったか分かるか
                             いつ言ったか分かるか
provenance_discoverability   原文へ戻る手段が見えるか
                             音声へ戻る手段が見えるか
correction_discoverability   誤りを直す手段が見えるか
action_transparency          AI が作ったものと出典の関係が分かるか
```

**正解は機械で分かる。** fixture は「その要素を消した／ずらした／偽った」姿なので、
何が YES で何が NO かは、作った側が知っている。当てられるかを測ればよい。

## 欠陥の型（fixture）

| 型 | 何を壊すか |
| --- | --- |
| `bad-no-source` | 出所を完全に消す |
| `bad-ambiguous-source` | 話者だけ。時刻も原文への道も無い |
| `bad-wrong-hierarchy` | 出所は在るが、その項目から遠い場所に置く |
| `bad-fake-confidence` | 根拠が無いのに「確認済み」と出す |
| `bad-contradictory` | 拾った文と、引いた原文が食い違う |

`bad-fake-confidence` と `bad-contradictory` を**高く**採点する採点者は、
Trust の評価者として不適格。出所の見た目だけを見て、中身を見ていない。

## 棄権を許す

`YES` / `NO` / `INSUFFICIENT_EVIDENCE` の 3 択にする。
「この絵からは決まらない」と言えることは、良い挙動。
無理に点を付けさせる方が危ない。

## 結果（2026-09-02）

fixture 8 枚（good 2 / good-open 1 / 欠陥 5 型）、Judge 3 体、YES/NO/棄権。
**正解は作った側が知っている**ので、当てられたかを機械で数えられる。

```
問い            正答
speaker         23/24   96%
time            23/24   96%
to_source       23/24   96%
to_audio        24/24  100%
to_fix          24/24  100%
────────────────────────────
観察できる 5 問  97.5%   誤って在ると言った 1.7%  見落とし 5.8%  棄権 0.8%
────────────────────────────
grounded        17/23   74%   ← 判断を要する問い
```

**分かれ目がはっきり出た。**

- 画面に何が在るかを聞くと **96〜100%** で当たる
- 「本当に結び付いているか」を聞くと **74%** に落ちる

```
TRUST_AFFORDANCE = PASS   → Evidence B。この軸で A/B/C 探索を再開してよい
grounded         = NOT_MEASURED
HOLISTIC_TRUST   = NOT_MEASURED（静止画 1 枚では原理的に決まらない）
```

### 絵ごとの成績

```
NO_SOURCE          18/18   出所を消したことは、はっきり分かる
GOOD_OPEN          18/18
AMBIGUOUS_SOURCE   17/17
CONTRADICTORY      17/18   食い違いは見抜けている
FAKE_CONFIDENCE    17/18   「確認済み」の空証明も見抜けている
GOOD               16/18
WRONG_HIERARCHY    15/18   ← いちばん弱い。出所が遠い場合の判断が割れる
```

`FAKE_CONFIDENCE` と `CONTRADICTORY` を見抜けているのは重要。
**出所の見た目だけを見て中身を見ない採点者ではない。**

### 途中で直した、正解表の誤り 2 件

自分で絵を見て気付いた。**採点者ではなく、私の正解が間違っていた。**

- `FAKE_CONFIDENCE` は時刻と話者が残る（消したのは出所への道だけ）
- `CONTRADICTORY` は**開かないと食い違いが見えない**。閉じた絵で撮っていた
