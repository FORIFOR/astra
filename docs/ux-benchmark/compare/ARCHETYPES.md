# 面の型（archetype）で比べる

**画面どうしを並べるのをやめる。同じ目的の面どうしを比べる。**

5 組でこれが分かった。VoiceOS の確認カード（1 つの用事）に Astra の
1080×680 の作業面をぶつけていた。Judge が言うとおり、比較条件が違う。

## 型の対応表

| 型 | Astra | 競合 | 状態 |
| --- | --- | --- | --- |
| Invocation | 待機 Dock / Listening | VoiceOS の起動・傾聴 | 素材未取得 |
| Screen Context | Context Dock | VoiceOS Point-to-Ask | **UI 素材が無い**（挿絵のみ） |
| Task Running | Task Dock | VoiceOS Agent 実行中 | 素材未取得 |
| **Action Confirmation** | **無い** | VoiceOS の確認カード | **MISSING_ARCHETYPE** |
| Meeting Controller | Meeting Dock | SuperIntern Control Bar | 比較可 |
| Live Notes | Meeting Notes | SuperIntern AI Canvas | Sample 01 / 04 |
| Captions | Captions | SuperIntern Transcript | Sample 05 |
| Full Work | Workspace | 相応する大面積 UI | 相手なし |

## MISSING_ARCHETYPE: ACTION_CONFIRMATION

**Astra には「これを送りますか」に相当する、小さく閉じた面が無い。**

比較不能ではなく、**対応する面が存在しない**。これは製品上の弱点。

VoiceOS は Gmail / Slack / Linear の確認を磨いており、宛先・件名／チャンネル・
本文の下見・Send / Edit をその場で確認させる。偶然の 1 画面ではなく中核の型。

### Astra ならどう作るか（新しい窓は作らない）

```
Task Dock
   ↓ morph
Compact Confirmation
   ↓ approve
Task Dock / Done
```

```
┌──────────────────────────────────────────┐
│ Gmail                                    │
│ これを送りますか？                        │
│                                          │
│ 宛先    ken@example.com                  │
│ 件名    リリース予定                      │
│                                          │
│ 明日 macOS 版を出します…                  │
│                                          │
│ 出所                                      │
│ 週次同期 · Ken · 10:42  ›                 │
│                                          │
│           取消    直す    送る            │
└──────────────────────────────────────────┘
```

VoiceOS の強み（**その用事だけに絞った小さい面**）に、
Astra の強み（**なぜそれをするのか辿れる**）を足す。

### 情報の順序（固定する）

```
① どのアプリ / 何が起きるか
② 何をするか
③ 決定的な値（宛先・時刻・相手）
④ 中身の下見
⑤ なぜ / 出所
⑥ 取消 / 直す / 実行
```

### 持ち込まないもの

```
sidebar / navigation / 無関係な文脈 / 履歴 / 会議の canvas 全体
```

**その瞬間の決断に要るものだけ。** ここが VoiceOS から学ぶ一番大事なところ。

## 面の大きさの目安

```
Idle                   300–380 × 48–56
Listening              520–680 × 68–92
Task Running           620–760 × 120–220
Action Confirmation    480–600 × 180–300
Meeting Controller     760–820 × 68–80
Meeting Notes Compact  760–900 × 320–480
Full Workspace        1000–1200 × 620–760
```

高さは固定せず中身で決める。

## 集計の重み

同じ設計の instance を票数にしない。

```
ARCHETYPE: Action Confirmation   weight = 1
  instance: Gmail  （安定性の確認に使う）
  instance: Slack
  instance: Linear
```

instance は「同じ答えが出るか」を見るために使い、総合では **1 型 = 1 票**。
これをしないと、素材の多い製品が有利になる。

---

# 中間の所見（優劣を主張しない）

```
INTERIM FINDINGS — DO NOT CLAIM SUPERIORITY

強い証拠
  - 会議の情報階層
  - 面の統合
  - 出所の見えかた
  - 状態の読み取りやすさ

見えてきた弱点
  - Action Confirmation の型が無い
  - 小さい用事での造形が VoiceOS に劣る
  - 原子的な操作に対して Full Workspace は過剰

分かっている取り引き
  - One Surface は連続性を上げる
  - **ただし「一つの固定した大きな面」を意味してはいけない**

設計の訂正
  ONE SURFACE  ≠  ONE SIZE
  正しくは
  ONE CONTINUOUS SURFACE  +  TASK-ADAPTIVE SIZE
```

**今回 VoiceOS に負けたのは One Surface という思想のせいではない。**
One Surface を「One Large Surface」と読み違えると弱くなる、というだけ。
一つの面が、仕事の粒度に合わせて**最小限の大きさへ変形する**のが理想。
