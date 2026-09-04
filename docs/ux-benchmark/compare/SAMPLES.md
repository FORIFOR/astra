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

---

# Sample 20 — 磨きの 7 チケット後に、型 6 種をもう一度測る（2026-09-03）

516720c（全面で日本語）・5d97f90（Meeting Notes を実寸で）・d9d9f36（右下 4 ボタン →
入力欄の 3 chip）・0e08dcc（Home の復旧行を一段下げる）・da0bd80（PLAN/CONTEXT の見出し、
面の中の影を外す）のあとの絵で、DS-05 と同じ 6 型・同じ 2 名・同じ問い。
**競合画像は各型の直前の標本と byte 一致**（sample11/12/16/17/18/19 から複製）。
Astra 側は 6 型とも直前の標本と画素が違う。

```
4D6A  astra-HEAD  docs/golden-screenshots/11-meeting-canvas.png        8508 = sample11/56B4
33F9  astra-HEAD  docs/golden-screenshots/04-recording-transcript.png  A7A4 = sample12/CF32
56B8  astra-HEAD  03-recording-workspace を x=0 から 1080x120           0DD0 = sample17/B41C
D2B3  astra-HEAD  docs/golden-screenshots/08-meeting-detail.png        D040 = sample19/9B47
2667  astra-HEAD  docs/golden-screenshots/04-recording-transcript.png  34DC = sample18/4F2E
400A  astra-HEAD  docs/golden-screenshots/task-dock/07-confirmation.png A366 = sample16/6A26
```

```
Sample 20  live_notes              Astra 7 / 競合 0 / 引分 0 / ct 1     （Sample 11: 7 / 0）
           captions                Astra 6 / 競合 0 / 引分 1 / ct 1     （Sample 12: 7 / 0）
           meeting_controller      Astra 4 / 競合 2 / 引分 1 / ct 1     （Sample 17: 4 / 1 / 2 / 1）
           post_meeting            Astra 4 / 競合 2 / 引分 1 / ct 1 ※   （Sample 19: 4 / 2 / 2 / 0）
           transcript_attribution  Astra 5 / 競合 3 / 引分 0 / ct 0     （Sample 18: 5 / 1 / 1 / 1）
           action_confirmation     Astra 6 / 競合 0 / 引分 1 / ct 1     （Sample 16: 6 / 0 / 1）
```

※ post_meeting の screen_occupation は sonnet が票を D040 に入れながら弁で
「画面に対する比率は cannot tell」と書いた。弁と票が矛盾する判定はその軸で捨て、
opus の ct と合わせて cannot tell にした（raw は 競合 3）。

## 軸別（有効 6 型、1 型 = 1 票。分母は軸を問うた型の数、tie / ct は勝ちに数えない）

```
                        live  cap   ctrl   post   attr  conf   Sample 20   DS-05 最終
information_hierarchy   A     A     A      A      A     —      5/5         5/5
state_legibility        A     A     A      tie·ct A     —      4/5         5/5  (post は 1 票)
provenance_visibility   A     A     C¹     A      A     A      5/6         5/6  (ctrl ct)
surface_fragmentation   A     A     A      C      C     —      3/5         3/5
control_visibility      A¹    A     A¹     C¹     A     A      5/6         4/6  (ctrl・post tie)
visual_density          A     tie   C¹     A¹     C¹    —      2/5         2/5  (post・attr tie)
visual_craft            A     A     C/A    A      A     A      5/6         5/6  (ctrl 引分)
screen_occupation       ct    ct    ct     ct     C¹    ct     0/6         1/6  (ctrl 1 票)
```

¹ = 1 票（もう 1 名が tie か ct）。A = Astra、C = 競合。DS-05 最終 = sample11/12/17/19/18/16。

## 変わった軸と、変わらなかった軸

```
control_visibility   4/6 → 5/6   live と ctrl が tie → Astra 1 票。post は tie → 競合 1 票
                                 （sonnet「D040 には検索・共有・メモ追加・Ask anything が同時に見える」）
provenance           ctrl ct → 競合 1 票（opus「0DD0 はマイク/スピーカーの名前を出す。56B8 に出所が無い」）
visual_craft         5/6 のまま。ctrl は opus が競合・sonnet が Astra で割れて引分（Sample 17 と同じ）
transcript_attr      density が 引分 → 競合 1 票、occupation が ct → 競合 1 票（面の広さの弁）
```

craft の弁は自分に有利なので画素で 1 つ確かめた: captions/opus
「33F9 は行の左端が揃い、時刻・話者・発言の 3 列が乱れていない」。
`33F9.png` の右パネルの発言 3 行（y=245 / 287 / 308）の左端は **x=794 で全行一致**、
左列の行も x=47 で揃っている。観察と矛盾しない。

ctrl の opus craft 票「録音中 と波形が左下に孤立して他の要素と揃っていない」は
Sample 17 で棄却した弁（文字と波形の高さ不揃い）とは別の主張で、120px の帯の中で
ピルが中央・文字が左下にあるのは絵のとおり。棄却せず割れとして残す。

## ここから言えること

- 516720c〜da0bd80 の 5 コミットは **どの型も落としていない**。6 型の合計は
  Astra 32 / 競合 7（DS-05 最終 33 / 4）。差分は ±2〜3 軸の panel 揺れの範囲で、
  動いた軸の弁はどれも今回の変更（Notes の高さ・3 chip・復旧行・影・文言）を指していない。
- 3 chip の弁は出ていない。control で live が Astra 1 票になった弁は
  「赤い停止・一時停止・各行の『直す』」で、chip ではない。
- 負けが固定している軸は 2 つ。**surface_fragmentation の post / attr**（sidebar +
  本文 + inspector の 3 列、上に浮く Dock）と **screen_occupation**（窓だけ撮影 vs 壁紙の上の小窓。
  judge では測れない。`--selftest occupation` で見る）。

## 限界

```
- 同じ絵で ±2〜3 軸ぶれる panel なので、1 型の 1 票差は読まない
- ctrl の帯は上のカードの始まりが写らない（Sample 17 と同じ限界）
- 競合は DS-05 の素材のまま。取り直していない
- 12 名分の弁は sample20/results/*.json、問いは sample20/prompts/*.md
```

# Sample 21 — craftL の規則を作業画面へ横展開してよいか、その面自身で測る（2026-09-03）

Library で成立した「話者を accent から落とす」（`compare/craftL`）を、作業画面の生きている
文字起こし（`TranscriptPanel`、37e1fa1）に当てた絵を、その面だけで A/B にした。
採用条件は先に決めた: **明確な悪化なし AND attribution / hierarchy のどちらか改善**。
引き分けなら Library の規則を根拠に押し通さず、作業画面だけ戻す。

- A = 871c867（話者 accent）、B = 37e1fa1（話者 secondary、「確定前」の印だけ accent）
- 差分は x793–823 の話者 1 列だけ（`ImageChops.difference` の bbox）。accent 画素 1937 → 1081
- 5 軸 + 採用。観察を先に書かせ、tie / cannot tell を許す

| judge     | O1 話者の色       | attribution | hierarchy | scanability | state | craft       | 採用 |
| --------- | ----------------- | ----------- | --------- | ----------- | ----- | ----------- | ---- |
| j1 opus   | A 紫 / B 灰（正） | **A**       | B         | A           | tie   | B           | B    |
| j2 sonnet | A 紫 / B 灰（正） | **A**       | tie       | A           | tie   | A           | A    |
| j3 opus   | A 紫 / B 灰（正） | **A**       | B         | A           | tie   | B           | B    |
| j4 sonnet | 2 枚とも紫        | —           | —         | —           | —     | cannot tell | 棄却 |

**結果: 戻す（作業画面は A のまま）。** hierarchy は opus 2 名が B、craft も B 2 / A 1 だが、
attribution が有効 3 名全員で A（j1「名前の列を探す一拍が要る」、j3「名前が本文に溶けている」）。
「明確な悪化なし」を満たさない。scanability も 3/3 で A。
1 型 = 1 票では opus → B、sonnet → A で割れる。

**分かったこと**: 同じ「時刻・名前・発言」の表でも、面の役割で色の意味が変わる。
Library（結論を読む面）では話者の accent は結論と競合する飾りだったが、生きている文字起こし
（誰がいま何を言ったかを拾う面）では話者の列が attribution の鍵で、色はそこで働いている。
規則は「accent は参照記号と選択にだけ」ではなく、「accent はその面で**鍵になる 1 つの列**にだけ」。

限界: 有効 3 名のうち sonnet は 1 名。j4（sonnet）は craftL の j2 と同じく色差そのものを見ていない。
測定器では差があり（画素 −44%）、opus 2 名と sonnet 1 名は知覚し、sonnet 1 名は知覚しなかった、
までに留める。
`results/j4.json` は判定者の出力に閉じ括弧が 1 つ余っていて JSON として読めなかった（`R3` の後の `}`）。
2026-09-04 に括弧 1 文字だけ直した（文言・判定は無変更）。

---

# Sample 22 — FINAL_COMPETITIVE_GATE の公開素材ぶん。凍結後の HEAD（3b870ce）で型 6 種を測り直す（2026-09-04）

本人の指摘「変更後の総合競合 benchmark をまだ再実行していない」に対する再実行。Sample 20 のあと
Astra 側で動いたのは 500c53a（文言）・7b2865d（4 タブ）・96a0405（privacy、絵は変わらない）・
3b870ce（Calendar、Home だけ）。Sample 20 と**同じ 6 型・同じ問い・同じ 2 名（opus / sonnet、
prompt と絵 2 枚しか見ない）**。競合 6 枚は sample20 と md5 一致（= DS-05 の素材のまま）。
Astra 6 枚は golden（`docs/golden-screenshots`、verify-all 9/9 一致）から取り、Sample 20 との
画素差は 0.7〜4.6%（`answers/diff-vs-sample20.txt`。文言と sidebar の項目）。

```
B40C  astra-HEAD  11-meeting-canvas.png                    FB3C = sample20/8508
BBA5  astra-HEAD  04-recording-transcript.png              875C = sample20/A7A4
C342  astra-HEAD  03-recording-workspace を x=0 から 1080x120  9D56 = sample20/0DD0
20BC  astra-HEAD  08-meeting-detail.png                    20C4 = sample20/D040
F863  astra-HEAD  04-recording-transcript.png              A2E4 = sample20/34DC
B0E7  astra-HEAD  task-dock/07-confirmation.png            4E91 = sample20/A366
```

```
Sample 22  live_notes              Astra 6 / 競合 0 / 引分 1 / ct 1     （Sample 20: 7 / 0 / 0 / 1）
           captions                Astra 7 / 競合 0 / 引分 0 / ct 1     （Sample 20: 6 / 0 / 1 / 1）
           meeting_controller      Astra 4 / 競合 3 / 引分 0 / ct 1     （Sample 20: 4 / 2 / 1 / 1）
           post_meeting            Astra 2 / 競合 3 / 引分 2 / ct 1     （Sample 20: 4 / 2 / 1 / 1）
           transcript_attribution  Astra 5 / 競合 2 / 引分 1 / ct 0     （Sample 20: 5 / 3 / 0 / 0）
           action_confirmation     Astra 6 / 競合 0 / 引分 1 / ct 1     （Sample 20: 6 / 0 / 1 / 1）
           合計                    Astra 30 / 競合 8 / 引分 5 / ct 5    （Sample 20: 32 / 7 / 4 / 5）
```

集計の規則は Sample 20 と同じ: 1 型 = 1 票、2 名が割れたら引分、tie / ct は勝ちに数えない。
弁と票が矛盾する判定は無かった（占有で票を入れたのは post/opus「壁紙の上の小窓 vs 画像いっぱい」と
attr/sonnet「カードの外に壁紙が見える」で、どちらも弁のとおり）。生の票は `sample22/answers/aggregate.json`。

## 軸別（有効 6 型。¹ = 1 票、もう 1 名が tie / ct）

```
                        live  cap   ctrl   post   attr  conf   Sample 22   Sample 20
information_hierarchy   A     A     A      A      A     —      5/5         5/5
state_legibility        A     A     A      ct     A     —      4/5         4/5
provenance_visibility   A     A¹    C¹     A      A     A      5/6         5/6
surface_fragmentation   A     A     A      C      C     —      3/5         3/5
control_visibility      tie   A¹    A      C¹     A     A      4/6         5/6
visual_density          A     A     C      割れ    A¹    —      3/5         2/5
visual_craft            A     A¹    C      割れ    tie   A      3/6         5/6
screen_occupation       ct    ct    ct     C¹     C¹    ct     0/6         0/6
```

## 動いた軸と、その弁

```
visual_craft   5/6 → 3/6
  ctrl  割れ → 競合   opus「ピルの付け根が下地に食い込む切り欠き」= 窓だけ撮った帯の透明部が
                       黒に潰れて見えている（golden も C342 も alpha=0。craft-check.txt）。
                       sonnet「録音中 がピルから離れて浮く」= Sample 17 で見た弁の再来
  post  A → 割れ      opus「[n] の前の空きが不揃い」→ 画素では 15 / 14 / 16 px、差 2px 以内。
                       違って見えるのは [1] だけ選択中の箱が付くから（状態の差）。sonnet は Astra
  attr  A → tie       opus「カード下部が大きく空く」vs「A2E4 は解像感が粗い」で決められない。
                       sonnet「粗さの有無を区別できない」
control_visibility 5/6 → 4/6
  live  A¹ → tie      2 名とも「FB3C にも Done と各窓の × がある」
  post  tie → C¹      sonnet「20C4 は戻る・検索・共有・Ask anything・Follow-up が同時に見える」
                       （Sample 20 と同じ弁）
visual_density 2/5 → 3/5
  cap   tie → A       opus「875C は箇条書きが下端の入力欄の裏に切れる」
  attr  C¹ → A¹       sonnet「F863 は密度がちょうどよく、A2E4 は余白が多すぎる」
```

craft の 3 つはどれも **Sample 20 から動いた画素（文言・sidebar）を指していない**。ctrl の絵は
pill の中と「録音中」の帯だけが 0.68% 違い、判定が変わった弁は帯の切り方の話。post の弁は測って
2px 以内。つまり craft の落ちは 7b2865d / 500c53a の結果ではなく、panel の ±2〜3 軸の揺れと
素材の限界（帯の透明部、窓だけ撮影）に収まる。凍結（DESIGN_SYSTEM §0）を解く根拠は出ていない。

## 型ごとの結論（FINAL_COMPETITIVE_GATE の公開素材ぶん。REALITY_GATES.md に転記）

```
Live Notes            勝つ    6/8、負けた軸なし。競合（SuperIntern AI Canvas）は Note / Transcript が別窓で重なる
Captions              勝つ    7/8、負けた軸なし。競合は 2 窓 + 検索欄が見出しに被る
Action Confirmation   勝つ    6/8、負けた軸なし。本文が切れない・「外部に出る」・出所 ›・esc / ⌘⏎
Transcript Attribution 勝つ   5/8。負けは fragmentation（浮くバー + 左右 + 入力欄）と occupation（窓だけ撮影）
Meeting Controller    割れる  4 / 3。今の用事（録音中・04:21・停止・一時停止）は勝ち、
                              行の揃い・密度・入力機器名（Microphone / System Audio）は SuperIntern Control Bar が勝つ
Post-meeting          割れる  2 / 3 / 2。要約→決定→やること の階層と [n] → 出所 は勝ち、
                              1 窓のまとまり・操作の数・占有は SuperIntern が勝ち、density / craft は 2 名が割れる
```

Meeting Controller の provenance 1 票（「Microphone: MacBook Air…」）は、`.meeting` をマイクだけに
した今、Astra の帯には**出す入力機器が 1 つしか無い**ことと対応する。MEETING_CAPTURE_REALITY で
system audio を繋ぐ日に、この行が本当に要るかが決まる（UI 案はまだ作らない）。

## 限界

```
- 同じ絵で ±2〜3 軸ぶれる panel。1 型の 1 票差は読まない（合計 30/8 と 32/7 は同じ範囲）
- 標本 6 つは本人の 9 型のうち 4 型（Live Notes・Meeting Controller・Confirmation・Library-Provenance）。
  captions と transcript_attribution は Astra 側が同じ絵（04-recording-transcript.png）なので
  Live Notes 型の副標本として扱い、型には数えない
- 公開素材が無い 5 型は測っていない: Invocation / Listening / Task Running（VoiceOS）、
  Workspace / Recovery（相手なし）。本人の hands-on 取得（voiceos/handson、
  superintern/handson、metadata.yaml に版と取得日）が来るまで NOT_COMPARABLE
- 競合は 2026-09-02 取得の公式素材（SuperIntern v0.10 / v0.14 の記事、VoiceOS 版表記なし）のまま
- ctrl の帯は透明部が黒く読まれる（craft-check.txt）。次に帯を作るなら机の背景を合成してから出す
- 12 名分の弁は sample22/results/*.json、問いは sample22/prompts/*.md、復号は answers/key.txt
- captions/opus の JSON は observations の閉じ括弧が 1 つ欠けて届いたので、それだけ足した（票と弁は無改変）
```
