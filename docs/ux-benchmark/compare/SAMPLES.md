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
> C5AB（Astra）は同時に多くのパネルを持つアプリ全体の画面」
> 「43B9（VoiceOS）は送る前の確認として、出所のアプリ・宛先・本文・実行と取消が
> はっきりしている」

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

---

# Sample 09 — Action Confirmation（同型比較）

実装したあと、**確認カードどうしだけ**で比べた。作業面は混ぜていない。

```
軸                       Astra  VoiceOS  引分
action_clarity             3       0      0
parameter_hierarchy        2       1      0
preview_readability        3       0      0
control_visibility         1       1      1
screen_occupation          1       1      1
visual_craft               1       1      1
error_prevention           3       0      0
provenance_visibility      3       0      0

Astra 5 / VoiceOS 0 / 引分 3
```

Judge の弁:

> 「C0FE（Astra）は本文が全部見え、**どの会議の誰がいつ**から来たかを名指しし、
> 外へ出る操作だと警告している」
> 「AFF1（VoiceOS）は効率を優先し、本文は途中で切れている」

## 引き分けた 3 つが次の課題

```
control_visibility   1-1-1   VoiceOS の Send は塗りつぶしの青で、より強い
screen_occupation    1-1-1   560x286 対 500x200。まだ大きい
visual_craft         1-1-1   ここは勝てていない
```

**`visual_craft` は引き分け止まり。** 型を揃えた 6 種で 2/6 だった弱点は、
確認の面を足しても解消していない。造形は別途やる必要がある。

## 何が効いたか

VoiceOS の写しではない。**VoiceOS の強み（その用事だけに絞った小さい面）に、
Astra の強み（なぜそれをするのか辿れる）を足した**結果:

```
error_prevention       3-0   外へ出る操作だと明示 ＋ 本文が全部見える
provenance_visibility  3-0   出所 週次同期 · 田中 · 10:42 ›
preview_readability    3-0   本文が切れない
```

## 受け入れ条件の残り（絵では分からない分）

撮った絵で見られるのは階層と寸法まで。鍵盤の割り当ても、窓を増やしていないかも、
高さが中身で決まるかも、絵には写らない。`--selftest confirmflow` で実際に動かす。

```
same NSPanel / new window 0     ✓ 窓の数が変わらないことを実測
focus theft 0                   ✓ 前面のアプリが変わらないことを実測
width <= 620pt                  ✓ 560
height <= 360pt                 ✓ 286
content-driven height           ✓ 中身を減らすと 286 → 176 に縮む
Escape = Cancel                 ✓ 実装（直している最中なら、直すのをやめる）
Return ≠ 破壊的な自動実行        ✓ Return には何も割り当てない
Cmd+Return = 実行               ✓ 実装
取り消しで元へ戻る              ✓ 実測
app / consequence / params /
preview / source / 3 つの操作    ✓ OCR で実測
決断に不要なものが無い          ✓ OCR で実測
```

**この検査自体が落ちることを確かめた。** 面を 900x400 に広げると
「幅 900pt（620 超）／高さ 400pt（360 超）／中身を減らしても高さが変わらない」
の 3 点で落ちる。

---

# Sample 11〜16 — DS-01〜04 のあとに、型 6 種を測り直した（DS-05）

Astra 側は DS-04 まで入った HEAD（6d84dcf）の絵。競合側は Sample 04〜10 と同じ
公開素材。判定は opus と sonnet の 2 名、観察を先に書かせ棄権を許す形
（`sample11/answers/PROMPT-ds5.md`）。**1 型 = 1 票。軸ごとに tie / cannot tell を
除いた票が全員一致ならその側、割れたら引分。**

```
Sample 11  live_notes              SuperIntern ライブ要約     Astra 7 / 競合 0            （占有 cannot tell）
Sample 12  captions                SuperIntern 文字起こし検索 Astra 7 / 競合 0            （占有 cannot tell）
Sample 13  meeting_controller      SuperIntern Control Bar    Astra 4 / 競合 3 / 引分 1
Sample 14  post_meeting            SuperIntern フォローアップ Astra 2 / 競合 5            （状態 cannot tell）
Sample 15  transcript_attribution  SuperIntern 話者分離       MATERIAL_INVALID ← 集計外
Sample 16  action_confirmation     VoiceOS Gmail 確認         Astra 6 / 競合 0 / 引分 1   （確認用 8 軸）
```

## 軸別（有効 5 型）

```
information_hierarchy    4/4   ■■■■
state_legibility         3/3   ■■■        （post_meeting は cannot tell）
provenance_visibility    4/5   ■■■■□
surface_fragmentation    3/4   ■■■□
control_visibility       3/5   ■■■□□
visual_craft             3/5   ■■■□□      ← 前回 2/6
visual_density           2/4   ■■□·
screen_occupation        1/5   ■□···      （3 型が cannot tell）
```

## Sample 15 は無効

競合側の画像（`sample08/images/78AE.png` = `sample15/images/E56B.png`）は
**空の白いパネル**で、文字も部品も写っていない。2 名とも観察にそう書いた:

> 「パネル内に文字・アイコン・ボタン・境界線が一切見えない（読める文字はゼロ）」

**Sample 08 の「Astra 6 / 競合 1」も同じ絵で採点していた。** あれは勝ちではなく
比較の不成立。話者分離の型は競合素材を取り直すまで集計に入れない。
Sample 01 の無効化と同じく、**採点者の観察が無ければ気付かなかった**。

## Sample 14 は絵が同じで数字が動いた

Sample 07 の Astra 画像と Sample 14 の Astra 画像は **pixel diff 0**（同じ状態の
同じ撮り方）。それで 4/2 → 2/5。差は絵ではなく判定者にある。
**2 名の panel は同じ絵に対して ±3 軸ぶれる。** 1 型の数字を単独で読まないこと。

とはいえ 2 名が揃って言う観察は残る:

> 「1539 は下半分と右パネルの大部分が空で密度が薄い」
> 「1539 には信号ドット以外に戻る・止める手段が見当たらない」

これは fixture の中身の量（発言 3 行・根拠 1 件）と、Library 詳細に戻る手段が
無いことで、DS-01〜04 の対象ではなかった。post_meeting の次の課題。

## visual_craft で落とした 2 型の理由

```
meeting_controller  「紫の波形がバーと繋がらず孤立して見える」（2 名一致）
                    → 900x120 の切り抜き方。波形は面の左上で「録音中」の右に
                      並ぶ録音インジケータで、切り抜きが「録音中」の文字だけを
                      落とした（x=90 から切った）。標本の作り方の問題
post_meeting        「右パネルの内容が上端に寄って余白が処理されていない」（opus）
                    → 上と同じ、中身の量
```

どちらも面が浮いている / 地が gradient / 余白が広い、ではない。
**Sample 10 で挙がった 5 つの負け筋は、今回の判定者の弁からは消えた。**

## 限界

```
- judges 2（3 ではない）。1 名 tie + 1 名勝ちは勝ちに数える（Sample 04〜08 と同じ規則）
- screen_occupation は面だけの絵からは測れない。judge ではなく selftest の寸法上限で見る
- 競合素材は Sample 04〜10 と同じもの。競合側は動いていない
- dark は採点していない（light のみ）
- 前回と判定者の顔ぶれが違う（前回 A/B/C、今回 opus/sonnet）。前回との差は
  ±3 軸の揺れの中にあり得る
```

---

# Sample 17: meeting_controller の標本を切り直す（2026-09-02）

Sample 13 の Astra 画像は 03-recording-workspace を **x=90 から 900x120** で切っていて、
「録音中」の文字が落ち、紫の波形だけが左端に浮いていた。2 名が揃って
「波形がバーと繋がらず孤立」と書いたのはそれ。標本の作り方の問題なので、
**x=0 から 1080x120** で切り直し、競合画像（`sample13/images/E22B.png` と
byte 一致）と同じ 2 名・同じプロンプトで採点し直した。

```
Sample 17  meeting_controller  SuperIntern Control Bar
  raw          Astra 4 / 競合 2 / 引分 1 / cannot tell 1
  実測後       Astra 4 / 競合 1 / 引分 2 / cannot tell 1   ← 集計はこちら
（Sample 13   Astra 4 / 競合 3 / 引分 1）
```

## 軸別

```
information_hierarchy   7D3A 7D3A   → Astra
surface_fragmentation   7D3A 7D3A   → Astra
screen_occupation       7D3A ct     → Astra（judge の占有は Evidence D。寸法ゲートは別）
state_legibility        7D3A 7D3A   → Astra
control_visibility      tie  tie    → 引分
visual_density          B41C tie    → 競合
visual_craft            B41C tie    → raw は競合、**opus の観察を実測で棄却して引分**
provenance_visibility   ct   ct     → cannot tell
```

## visual_craft の opus 票を捨てた理由

opus の弁は「録音中 の文字と波形の高さや位置がやや不揃いに見える」。
標本の画素で測ると、文字の縦範囲は **y=79〜92**、波形の縦範囲も **y=79〜92**
（2x 画像、`PIL` で暗い画素と紫の画素の行を取った）。同じ高さに同じ範囲で
並んでいる。観察が実測と矛盾した判定者はその軸で捨てる（craft13 の j1 と同じ規則）。
sonnet は「no visible misalignment in either image」で tie。残る票は tie なので引分。

Sample 13 の「波形が孤立」は 2 名から消えた。切り抜きの問題だったことは確認できた。

## 同じ競合画像で動いた軸

競合画像は byte 一致なのに、provenance が「競合 2 票」→「cannot tell 2 票」、
density が「tie 2 票」→「競合 1 / tie 1」へ動いた。Sample 14 と同じで、
**2 名 panel は同じ絵に対して ±2〜3 軸ぶれる。** 1 型の数字を単独で読まないこと。

## 限界

```
- 競合画像は設定パネルが開いた状態、Astra は帯だけ。sonnet が「状態が違う」と注記した
- 120px の帯なので、Astra 側は上のカードの始まりが写らず「空きが目立つ」（opus の density）
- 面積は絵から測れない（sonnet: cannot tell）。占有は `--selftest occupation` で見る
```

---

# Sample 18: transcript_attribution の競合素材を取り直す（2026-09-02）

Sample 08 / 15 の競合画像（`superintern/public/speaker-diarization.png`）が空の白い
パネルだった理由が分かった。元の `speaker-diarization.webp`（v0.10 の公式ブログ、
話者分離のデモ）は **53 コマの動画**で、`.png` はその 1 コマ目。中身が出るのは
4 コマ目から。**30 コマ目**（You / Mike / Lisa の 3 行の時間軸と波形が揃う）を
`speaker-diarization-frame30.png` として取り、Astra は今日の
`04-recording-transcript`（Sample 15 の絵と同じ状態）で採点した。

```
Sample 18  transcript_attribution  SuperIntern 話者分離デモ（30 コマ目）
  raw          Astra 4 / 競合 1 / 引分 2 / cannot tell 1
  実測後       Astra 5 / 競合 1 / 引分 1 / cannot tell 1
```

## 軸別

```
information_hierarchy   D07B D07B   → Astra
surface_fragmentation   4F2E 4F2E   → 競合（「上部の黒いバーが本体と別の窓に見える」「区画が多い」）
screen_occupation       ct   ct     → cannot tell
state_legibility        D07B D07B   → Astra ※素材限界
control_visibility      D07B D07B   → Astra ※素材限界
visual_density          tie  tie    → 引分
visual_craft            4F2E D07B   → raw は割れて引分、**opus の観察を実測で棄却して Astra**
provenance_visibility   D07B D07B   → Astra
```

## 集計に入れる軸と入れない軸

競合画像は **デモの図**で、文字起こしの本文も操作も写っていない（sonnet:
「単体の可視化コンポーネントに近く画面全体の文脈が読み取れない」）。
「撮られた状態に見えないことを製品に無いと読まない」（`superintern/public/sources.md`）
ので、**state_legibility / control_visibility / screen_occupation はこの型では
数えない**。action_confirmation を共通 4 軸だけで数えたのと同じ扱い。
集計に入れるのは hierarchy / fragmentation / density / craft / provenance の 5 軸。

## visual_craft の opus 票を捨てた理由

opus の弁は「右下 4 ボタンの左右で背景の濃さが違い」。4 つのボタンの塗りを
画素で測ると **236 / 236 / 237 / 237**（RGB、文字を避けた 10x9 の平均）。
同じ色。観察が実測と矛盾したのでこの軸の票を捨てる（Sample 17 と同じ規則）。
残る sonnet の票は D07B。ただし sonnet の理由（「4F2E はバーの区間位置が
やや不揃い」）は時間軸の図では区間がずれているのが正しいので、**弱い**。
1 名の弱い理由で取った craft として読む。

opus のもう 1 つの craft の弁「上部バーの被りも雑に見える」は、Task Dock が
Workspace の凹みに食い込む造形⑧の設計そのもの。DS-04 で 3/3 で選んだ側なので
戻さない。fragmentation の負けも同じ観察から来ている（2 名一致）。

## 限界

```
- 競合はデモの図。製品の文字起こし画面ではない。話者分離の「表示」の比較であって
  「面」の比較ではない
- Astra の面は Workspace 全体（1080x680）、競合は 820x480 のカード。占有は測れない
- craft は 1 名の票
```

# Sample 19 — post_meeting を 547dd40 の絵で採点し直す

Sample 14 は 547dd40 より前の絵（戻る手段なし・発言 3 行）で採点していた。
Astra 側だけ今日の `docs/golden-screenshots/08-meeting-detail.png`（1240x820）に
替え、競合画像は Sample 14 の `A00B.png` と **byte 一致**、判定者も同じ 2 名。

```
C6E1  astra-ds5-547dd40       docs/golden-screenshots/08-meeting-detail.png
9B47  superintern-followup    = sample14/images/A00B.png
```

## 軸別

```
                        opus  sonnet
information_hierarchy   C6E1  C6E1   → Astra
surface_fragmentation   9B47  9B47   → 競合（「左ナビ・中央・右の 3 列」2 名一致）
screen_occupation       9B47  9B47   → 競合（「壁紙が残る小窓」対「端まで面が続く」）
state_legibility        ct    C6E1   → Astra ※1 票。sonnet は選択行のハイライトを状態と読んだ
control_visibility      tie   tie    → 引分（「どちらも戻る矢印とタブ」）
visual_density          tie   tie    → 引分（「C6E1 は下部が空、9B47 は入力欄が本文を覆う」）
visual_craft            C6E1  C6E1   → Astra（「時刻・話者・本文の列が揃っている」）
provenance_visibility   C6E1  C6E1   → Astra
```

**Astra 4 / 競合 2 / 引分 2 / ct 0**（Sample 14 は 2 / 5 / 0 / 1）。

## Sample 14 の弁がどうなったか

```
「1539 には信号ドット以外に戻る・止める手段が見当たらない」(sonnet)
  → 「両者とも戻る矢印とタブ切替が見えており」(sonnet)。control は 競合 → 引分
「右パネルの内容が上端に寄って余白が処理されていない」(opus, craft)
  → 消えた。craft は 競合/tie → 2 名とも C6E1
「下半分と右パネルの大部分が空で密度が薄い」(2 名)
  → 「下部に大きな空白が残り」は残る(opus)。density は 競合 → 引分
```

craft の弁は自分に有利なので実測で確かめた: 文字起こし 8 行の左端は
**x=295 で全行一致、行間 31px**（y=390〜620）。観察と矛盾しない。

## 残る負け筋

fragmentation と occupation はどちらも 2-0 で負け。fragmentation は
sidebar + 本文 + inspector の 3 列（§7.1 の設計）。occupation は Astra が
**窓だけの撮影**で競合が壁紙の上の小窓という素材の非対称で、2 名とも
「C6E1 は端まで面が続く／比率は分からない」と書いた上で 9B47 に入れている。
実寸は `--selftest occupation` で測る（DESIGN_SYSTEM §7）。

## 限界

```
- state は 1 票、理由も弱い（選択行のハイライト ≠ 録音中/処理中）
- occupation は撮影方法の差が出ている。判定は残すが読み替えない
- 2 名 panel の ±2〜3 軸の揺れは Sample 14 → 19 にも含まれうる
```
