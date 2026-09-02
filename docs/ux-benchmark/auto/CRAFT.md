# 造形をどう見るか — 2 層に分ける

**±2pt を通しても、美しくなるとは限らない。** 正確さと美しさは別のもの。

```
GEOMETRY_GATE   決定論で判定する          機械が数える
  行の揃い / baseline / padding が token と一致 / 角丸 / ボタンの高さ / 図形の位置

CRAFT_GATE      fixture で検証した採点者だけ  人の目に近いほう
  階層 / 際立ち / 詰まり具合の釣り合い / 字面の律動 / 目で見た釣り合い / 奥行き
```

Geometry は数えられる。Craft は数えられない。**混ぜると、数えられるほうだけを
直して満足する**ことになる。

## 変える順番（固定）

一度に全部変えない。段階ごとに A/B/C で比べ、効いたものだけ残す。

```
① 主たる操作の際立ち
② 字面の階層
③ 行の揃い
④ 意味のある余白
⑤ ボタンの寸法
⑥ 境界 / 区切り
⑦ 角丸
⑧ 影 / 奥行き
⑨ 図形の見た目の重さ
```

**Confirmation を実験場にする。** 小さいので、変えたことと結果の因果が見える。
そこで得た規則を、他の 5 つの型へ広げる。

## 鍵盤の約束（安全側に倒す）

```
Escape       取消
Return       外へ出る操作・壊す操作を走らせない
Cmd+Return   実行（明示）
ポインタ      実行のボタン
```

メール送信・削除・外部への共有・購入は、**普通の Return で走らない**。
これは造形ではなく安全の話なので、ゲートで固定する。

## 目標

外の製品を pixel で写さない。**Astra の白基調で、同等以上の完成度**にする。

---

# ① 主たる操作の際立ち — 1 周目は revert

Confirmation を実験場に、3 案で比べた。

```
案      内容
base    いまのまま（実行=警告色の塗り／直す=強調色／間隔 8）
B       実行=brand 色／直す=静かに
C       B ＋ 間隔 8→14、操作の上に余白 6
```

## 3 案の順位（Judge 3 体）

```
軸                        1 位   2 位   3 位
primary_action_salience    c      b     base
control_visibility         c      b     base
visual_craft               b      c     base
semantic_colour           base    b      c     ← 色だけ base が勝った
overall                    b      c     base
```

**色で割れた。** 採点者の言い分:

> 「この面には『外部に出る』という札が amber で出ている。だから送るボタンも
> amber だと、系として一貫する」

もっともなので、**色は変えず、争いのない部分だけ**採ることにした。

## 採ったつもりの分を before/after で測ったら、落ちた

```
軸                        after  before  引分
primary_action_salience     2      1      0
control_visibility          0      3      0     ← 落ちた
visual_craft                1      1      1
error_prevention            0      2      1
overall                     0      1      2

after 1 / before 3 → revert
```

> 「取消（灰）・直す（強調）・実行（塗り）の 3 段があるほうが、
> それぞれの重さが読める。両方を灰にすると 2 段になる」

**「目を引くものは 1 つだけ」という原則が、ここでは裏目に出た。**
3 つの操作の**相対的な重さ**が読めるほうが、control_visibility は高い。

また、間隔を 8 → 14 に広げた分は **3 体中 2 体が「違いは Edit の色だけ」**と
答えた。つまり見えていない。効かない変更だった。

## この周の結論

```
① 主たる操作の際立ち   → 改善する案が見つからなかった。revert。
```

visual_craft は 6 種で 2/6 のまま。**次は ② 字面の階層**へ進む。
色と際立ちは既に釣り合っている可能性があり、伸びしろは別の段階にある。

---

## ② 字面の階層 — C を採用

`docs/ux-benchmark/compare/craft3/`。3 案を伏せて 3 人（Sonnet×2 / Haiku×1）に採点させた。

| 軸                    | 1位   | 2位 | 3位 |
| --------------------- | ----- | --- | --- |
| role_legibility       | **C** | A   | B   |
| visual_craft          | **C** | A   | B   |
| information_hierarchy | **C** | A   | B   |
| preview_readability   | A     | B   | C   |
| provenance_visibility | A     | B   | C   |
| screen_occupation     | A     | B   | C   |
| overall               | **C** | A   | B   |

下 3 軸の順位は採らなかった。理由は 2 つある。

**1. 面積は目で測ってはいけない。**
3 人とも「C は背が高い」と書いた。判断の根拠も揃っている ——
「`# Slack` と `外部に出る` が 2 行に分かれるぶん高くなる」。
実寸は 3 枚とも **560x286 で同じ**だった。C の警告は題の下の余白へ入っており、
面は伸びていない。審査員は版面を見て高さを**推論**しただけで、測っていない。

以後 screen_occupation は `scripts/ux-auto/occupation.py` が出す（Evidence A）。
審査員の screen_occupation は **Evidence D として捨てる**。

**2. preview / provenance は「差が見えない」と本人たちが書いている。**
3 人中 2 人が本文について「identical — no readability difference」、
3 人とも出所について「identical across all three」と明記したうえで、
順位を求められたので並べた。順位は付いたが差は無い。
B の変更（ラベル 11→10.5pt、濃度 0.72、出所 0.8）は**視認閾値の下**にある。

つまり測れた向上は **警告を独立した段へ出したこと**から来ている。
字を 0.5pt 動かしたぶんではない。

### 採用条件の照合

| 条件                           | 判定                   |
| ------------------------------ | ---------------------- |
| visual_craft 向上              | ✅ 3/3 一致で C        |
| information_hierarchy 低下なし | ✅ 向上                |
| preview_readability 低下なし   | ✅ 差が観測されない    |
| provenance_visibility 低下なし | ✅ 差が観測されない    |
| screen_occupation 増加なし     | ✅ 実測 560x286 で同一 |

C を既定にした（`VoiceHUDView.swift` の `TypeVariant` は削除）。
CONFIRMATION_GATE = PASS（6 段すべて OCR で確認、560x286pt）。

---

# ③ 行の揃い — 目で採点させる前に測った

行の揃いは数えられる。GEOMETRY 側の話なので、A/B/C を伏せて人に聞く前に
描かれた絵から測る（`scripts/ux-auto/alignment.py`）。
`tools/ux-lab/ocr` が Vision の枠も出すので、段ごとの左端と間隔が取れる。

測っているのは字の**墨の左端**で、SwiftUI の frame ではない。
和文と欧文で左の余白が違うので ±2pt は動く。左端のずれはそこで濁る。
**濁らないのは間隔のほう**なので、そちらを見た。

## 出たもの

```
段の間（採用直後の confirmation）
      6.0pt   # Slack → このメッセージを送りますか？
      4.9pt   このメッセージを送りますか？ → 外部に出る
      6.9pt   外部に出る → #sales
      4.0pt   差出人 → 明日の会議、資料を先に…
     25.0pt   明日の会議、資料を先に… → 出所 週次同期・田中・10:42   ← 穴
```

※ この時点の値は 2x と誤って半分に割っている。実寸は倍で、穴は **50pt**。
撮り方で倍率が変わるのに、測定器が 2x を決め打ちしていた。
`alignment.py` は面の実幅から倍率を決めるように直した。

## 原因は 2 つあって、両方とも「高さを決める場所が 2 つある」こと

**1. `ScrollView` は差し出された高さを全部取る。**

```swift
ScrollView { Text(preview) }
    .frame(maxHeight: 66)
```

`maxHeight` は上限であると同時に**下限**として働く。1 行の下見でも 66pt を占めた。

**2. 面の高さが、それとは別に 2 行ぶんを予約していた。**

```swift
if preview != nil { n += 2 }          // contentRows
h = 176 + (contentRows - 1) * 22      // size()
```

基準の 176 が何を含むのか、もう誰にも言えない状態だった。
行の数え方だけが変わっていき、面は中身より高くなり、
余りが `Spacer(minLength: 0)` に吸われて**穴**として出た。

## 直した

高さを決める場所を 1 つにした。`ActionConfirmation.surfaceHeight` が
`ConfirmationDock` の積むものをそのまま足す —— 余白・段の間・
font から取った 1 行の高さ・折り返しを含めた題と本文の実寸・操作の 32pt。
下見は 66pt に収まるなら `ScrollView` を置かない（置くだけで摘みが出て、
1 行の下見の右肩に動かせそうな灰色の棒が残っていた）。

```
面の高さ    286pt → 224pt   （中身は 1 文字も減っていない）
中身の間    4〜25pt → 8〜14pt（中央値 10、操作の手前 26 は区切りとして除外）
```

**②「面積は目で測らない」の裏返しがここで出た。** craft3 の採点者は
C を「背が高い」と言った。実際に高かったのは 3 枚とも同じで、
中身ではなく**式**だった。目で見ていたら、字の大きさを削って直していた。

## ゲートにした

`CONFIRMATION_GATE` に穴の検査を足した。

```
中身の段の間の中央値を取り、その 2 倍を超える間があれば FAIL。
操作の手前の間だけは除く（そこは間隔ではなく区切り）。
```

壊れていたころの絵（`compare/craft3/images/D420.png`）に当てると
50pt の穴を指して exit=1、直したあとの絵で exit=0。
**落ちることを確かめてから入れた。**

文字が全部出ていれば OCR の検査は通ってしまう。式と view がずれても
何も欠けないので、ここを見ていなければ気づけない。

## 採点は 2 回やった。1 回目は自分で矛盾した

穴を埋めた面（224pt）と埋める前の面（286pt）を伏せて 3 人に見せた。
1 回目（`compare/craft4`）は **before が勝った**。

```
spacing_rhythm        before 2 : after 0
control_reachability  before 2 : after 0
overall               before 2 : after 1
```

ところが理由を読むと、同じ画像について逆のことを書いていた。

> Judge 2:「B71F はボタンが出所から**遠く**離されている」
> Judge 3:「B71F はボタンが content に**近い**」

実測は before 29.9pt → after 26.0pt。Judge 3 が正しく、Judge 2 は逆。
決定的だった唯一の軸（control_reachability 2:0）は、**片方が事実を
取り違えた票**で立っていた。Judge 1 は「pixel-for-pixel identical」と書き、
50pt の帯そのものを見ていない。

②「面積は目で測らない」と同じ形。**間隔も目で測らせてはいけない。**

## 訊き方を変えたら揃った

2 回目（`compare/craft5`）は、好みを訊く前に**観察**を訊いた。
「どちらが大きいか」を答えさせ、**「分からない」を正解として許した**。

```
本文→出所 が大きいのは    3人中2人が before と回答（実測 50.0 vs 9.9pt、正解）
出所→操作 が大きいのは    2人 same / 1人 before（実測 29.9 vs 27.9pt、ほぼ同じ）
説明のつかない空き        3人中2人が before の本文と出所の間を指した
中身の欠落                3人とも無し
```

そのうえでの好み:

```
visual_craft          after 2 : before 0
spacing_rhythm        after 2 : before 1
preview_readability   after 2 : before 0
control_reachability  after 0 : before 0  （2人が tie）
overall               after 2 : before 1
```

**好みを先に訊くと、理由が後から作られる。** 観察を先に置き、
棄権を許すと、事実が揃い、結論もひっくり返った。
`JUDGE_PROMPT.md` の型をこれに合わせる。

## 潰れも見るようにした

穴を埋めた拍子に、本文と出所の間が **4pt** まで潰れていた（中央値 10pt）。
穴だけ見ていると気づけないので、`alignment.py` は
**中央値の半分未満**も FAIL にする。出所に `.padding(.top, 5)` を入れて直した。

```
面の高さ    286pt → 229pt
中身の間    4〜50pt → 7.9〜13.7pt（中央値 9.9、操作の手前 27.9 は区切り）
```

---

# ④ 意味のある余白 — revert

③ で間隔は揃った（中央値 9.9、7.9〜13.7）。揃ったぶん、**どこで意味が切れるか**が
余白から読めていないのではないかと考えた。確認の面が言っていることは 4 つに分かれる。

```text
何が起きるか    Slack / このメッセージを送りますか？ / 外部に出る
何に対して      宛先 #sales / 差出人 あなた / 本文
どこから来たか  出所 週次同期・田中・10:42
どうするか      取消 / 直す / 送る
```

群の中を詰め、群の間を空けた（`Spacing(within: 6, between: 15)`）。
実測で群内 5.8〜10pt / 群間 14〜19.8pt と、はっきり 2 段に分かれた。

## 効かなかった

```
grouping_legibility   grouped 0 : flat 0  (tie 3)   ← 変えた目的そのもの
visual_craft          grouped 0 : flat 0  (tie 3)
scan_speed            grouped 0 : flat 0  (tie 3)
information_hierarchy grouped 0 : flat 1  (tie 2)
screen_occupation     grouped 0 : flat 1  (tie 2)   ← 6pt 高い
overall               grouped 0 : flat 1  (tie 2)
```

観察のほうがはっきりしている。

> 3 人とも、**両方の画像で同じ数の群を見ている**（4/4・4/4・5/5）。
> 「どちらが間隔にばらつきがあるか」は 3 人中 2 人が **cannot tell**。

つまり **flat の時点で、もう 4 つの群に見えていた**。
群を分けているのは余白ではなく、字の大きさと濃さ（②で入れた階層）と、
ラベル付きの行という形そのものだった。余白を 2 段にしても、
すでに読めているものを言い直しただけで、6pt 背が高くなった。

revert。`Spacing` も消した。

**棄権を許したことが効いた。** 「どちらが大きいか」に無理やり答えさせていたら、
2 票が片側に付いて「差がある」ように見えたはずで、
差の無い変更を採用していた（`craft4` がまさにそれ）。

※ Judge 2 は grouped で出所の `›` が消えていると書いたが、OCR は両方で
`＞` を読んでいる。事実誤り。今回は revert なので結論に影響しない。

---

# ⑤ ボタンの寸法 — 採用

実測から始めた。宣言値は「3 つとも高さ 32pt、左右の余白 14/14/20」。
そこから出る**実際の当たり判定**は:

```
Cancel  76 x 32pt
Edit    58 x 32pt
送る    68 x 32pt   ← 主たる操作が、逃げ道より小さい
```

「送る」は 2 文字、Cancel は 6 文字。padding だけで大きさを決めると
**字数で重さが決まる**。日本語の主たる操作は短くなりがちなので、
padding 方式のままでは英語の逃げ道に負け続ける。

`confirmPrimaryMinWidth: 96` を token に足して下から支えた（68 → 96pt）。

## 目では見えない差だった

3 人とも「before でも 送る が最も広い」と答えた。**実測では負けている。**
Judge 1 は根拠まで書いていて、そこに理由がある:

> 「送る の幅 68px に対し Cancel の**文字**は 45px」

塗られた矩形と、文字の墨を比べている。**目は塗られた矩形を見るが、
指が当たるのは押せる矩形のほう。** Cancel は塗りが無いだけで、
実際には 76pt ぶん押せる。採点者に当たり判定は測れない。

```
primary_action_salience   after 1 : before 0  (tie 2)
error_prevention          after 1 : before 0  (tie 2)
control_visibility        after 0 : before 0  (tie 3)
visual_craft              after 1 : before 1  (tie 1)
overall                   after 1 : before 0  (tie 2)
```

負けは無い。採用。

## ゲートにした ——「壊しても落ちない」を 1 回作った

`scripts/ux-auto/primary.py`。塗られた矩形を `tools/ux-lab/rect` で画素から測り、
逃げ道（塗りが無いので墨 + 左右 14pt）と比べる。

最初の版はラベル名で逃げ道を拾っていた（`$2=="Cancel"`）。
minWidth を 40 に落として試したら、OCR が `Cancell` と読んだ回に
完全一致が外れ、より狭い Edit と比べて **PASS した**。
壊しても落ちないゲートを作っていた。

いまは**塗りと同じ高さの帯に居る文字を全部**逃げ道として数える。
40 / 70 / 96 の 3 通りで確かめた。

```
minWidth=40   ✗ 主 68pt が逃げ道 76pt（Cancell）より小さい
minWidth=70   ✗ 主 70pt が逃げ道 74pt（Cancel）より小さい
minWidth=96   ✓ 主 96x32pt が逃げ道 76pt（Cancel）以上
```

※ Judge 2 は「after で出所の `›` が消えている」と書いた。④ でも同じことを
書いており、2 回とも事実誤り。Judge 1 の画素差分が
「違うのは操作の行だけ（x 309-517, y 192-224）」と示している。

---

# ⑥ 境界 / 区切り — revert

④ で余白による群分けが効かなかったので、線という別の仕掛けを試した。
中身と操作の間に白 10% の 1pt を引く（`compare/craft8`）。

```
control_separation  線あり 0 : 線なし 0  (tie 3)   ← 引いた目的そのもの
calmness            線あり 0 : 線なし 1  (tie 2)
visual_craft        線あり 0 : 線なし 0  (tie 3)
overall             線あり 0 : 線なし 1  (tie 2)   ← 10pt 高いぶん負け
```

観察のほうが決定的だった。

> 3 人とも「**どちらにも線は無い**」と答えた。

線は在る。画素で測ると `y=187` に明るさ 22（地は 0）。
**知覚の閾値の下**だった。もっと濃くすれば見えるが、
④ が言っているのは「境界はもう読めている」なので、
濃い線は境界を作るのではなく雑音を足すことになる。revert。

## ④ と ⑥ で分かったこと

境界を強める手を 2 つ試して、2 つとも効かなかった。

```
④ 余白で分ける   群の数は、変える前から同じに見えていた
⑥ 線で分ける     引いた線は、そもそも見えていなかった
```

**この面の境界は、余白でも線でもなく、字の階層（②）と
ラベル付きの行という形が作っている。** ここに手を入れる余地はもう無い。
⑦⑧⑨ へ進むか、他の archetype へ展開するほうが得る物が大きい。

## 途中で見つけた欠陥

線を足したら下の余白が 12pt → 7pt に削れた。面の高さに線を数えていなかった
ためで、③ で潰した「高さを決める場所が 2 つある」がそのまま再発している。
判定の前に直した（`surfaceHeight` に `gap + 1` を足す）。
**新しく積むものを足すときは、必ず高さにも足す。**

---

# ⑦ 角丸 — revert

操作の角丸だけ 3 通り。面の外形（上 10 / 下 18）は動かさない
（動かすと Dock 全体の姿が変わり、何が効いたか分からなくなる）。

```
base   ボタン 7 / 出所・入力欄 6   ← いまの姿
soft   ボタン 10 / 8
crisp  ボタン 5 / 4
```

```
visual_craft   base(6)  crisp(4)  soft(2)
coherence      base(5)  crisp(5)  soft(2)
overall        base(6)  crisp(4)  soft(2)
```

観察のほうが要点を言っている。

> 3 人中 2 人が、角丸の順序を **cannot tell**。

画素で測った 1 人（soft > base > crisp と正しく並べた）も、
そのうえで base を 1 位に置いた。**判別できる人にとっても、
現状がいちばん良い**という結論。revert。

面の下の角 18pt、ボタンの下辺は面の底から 12pt。
18 − 12 = 6 で、7 は既にほぼ同心になっている。動かす理由が無かった。

## 採点者が繰り返す作り話 — 出所の `›`

これで 3 回目。

```
craft7  Judge 2「after で › が消えている」
craft8  Judge 1「norule で › が消えている」
craft9  Judge 1「base と crisp で › が消えている」
```

指す画像は毎回違う。craft9 では別の採点者の画素差分が
「3 通りのどの組み合わせでも違うのは (442,192) の操作の矩形だけ」と
示しており、`›` は 3 枚とも同じ。

面の右下、8pt の `chevron.right` —— **知覚の縁にある小さな図形**で、
採点者はここで作り話をする。以後 `content_lost` にこの `›` が出たら、
画素差分で確かめるまで採らない。

---

# ⑨ 図形の重さ — 採用

確認の面には小さな図形が 3 つある。役割は違う。

```text
#  どのアプリか      説明する
›  出所へ            押せる
↗  外部に出る        状態が重い
```

意味の順は **説明 < 押せる < 重い** のはずだが、実際は:

```
直す前   #  11pt medium    ← 説明なのに、大きさは最大
         ›   8pt semibold
         ↗   9pt semibold  ← 押せるものと同じ重さ
```

重さが `medium < semibold = semibold`。**押せるものと危ないものに差が無い。**
大きさに至っては 11 > 9 > 8 で意味と逆順。

```
直した後 #  11pt regular
         ›   8pt semibold
         ↗  10pt bold
```

## 見えない差だが、採る

3 人中 2 人が「重さの違いは cannot tell」。1 人が画素の明るさで測った。

```
直す前   # 20488  ≈  ↗ 20432   （0.3% 差 —— 飾りと警告が同じ重さ）
直した後 ↗ 23531  >  # 17633   （33% 差）
         ›  4328（変えていない）
```

```
icon_hierarchy   semantic 1 : flat 0  (tie 2)
visual_craft     semantic 1 : flat 0  (tie 2)
overall          semantic 1 : flat 0  (tie 2)
risk_legibility  semantic 0 : flat 0  (tie 3)
calmness         semantic 0 : flat 0  (tie 3)
```

負けは無い。

**④⑥ と何が違うのか。** ④⑥ は「すでに正しく読めているものを、
別の手段で言い直した」ので何も起きなかった。⑨ は **並び自体が間違っていた**。
飾りの `#` と「外部に出る」が同じ重さなのは、
見えるか見えないかとは別の、構造の誤り。

ゲートは置いていない。図形の領域を絵から特定する経路が脆いため
（`content_lost` の `›` で 3 回作り話が出たのと同じ場所）。
規則はコードの註（`ActionConfirmation.Glyph`）に書いて、
他の archetype へ展開するときの拠り所にする。

---

# ⑧ 影・奥行き — 採用。ただし当初の案とは違う形で

`detached_overlay`（Dock が別の窓に見える）を、**material には触らず**
`NSWindow.hasShadow` の切り替えだけで測った。自前の影は描かない。

当初の案:

```
A  全状態で影あり（いまの姿）
B  全状態で影なし
C  小さい面は影なし / 広がった面は影あり   ← 本命
```

## 影を測るための撮り方を作った

既存の撮り方（`boundsIgnoreFraming`）は**外形の外を切り落とす**ので、
影を変えても絵が 1px も変わらない。`ASTRA_SHOT_SHADOW=1` で外形の外まで撮り、
決まった地の上へ合成する（`SelfTest.onBackdrop`）。

地は**合成**である。実際の画面は撮らない —— 一度それをやって、
利用者の Finder とメールが証拠に混ざった。

## harness の欠陥で、一度は逆の答えが出た

最初の合成では、上辺にメニューバーの帯を描き、その **10px 下**に面を置いた。
3 人中 2 人が、その隙間を根拠にした。

> 「影ありは面がメニューバーに**吸い付いていて**、影なしは**隙間**があるので別窓に見える」

隙間は harness が作った嘘だった。

```swift
// PanelPositioner.voiceHUDFrame
y: screen.frame.maxY - size.height   // 面の上辺 = 画面の上辺
```

Dock の上辺は画面の上辺そのもので、隙間は無い。**無い物を比べていた。**

直す過程でもう 2 つ harness の欠陥が出た。どちらも「影を比べるつもりで
別のものを比べる」形になっていた。

```
地が固定 760x380 だった      agent（幅 720）が切れ、影ではなく切れ方を比べていた
面の位置が 2〜4px ずれた     面が半透明（黒 80%）なのに「不透明なら面」で探しており、
                             影でぼけた角の 1 行を上辺と誤っていた
```

面の幅の 1/4 以上が alpha ≥ 160 の**行**を面とみなすようにして揃えた。

## 直したら結論が反転し、しかも一致した

```
A 小さい面（confirmation）    B 広がった面（agent）
belongs_to_screen 影なし 3:0  belongs_to_screen 影なし 3:0
separate_window   影あり 3:0  separate_window   影あり 3:0
craft             影なし 3:0  craft             影なし 3:0
overall           影なし 3:0  overall           影なし 3:0
```

**広がった面でも影は要らない。** C 案の前提が崩れた。
理由は後から見れば当然で、agent の面も**同じ Dock が下へ伸びたもの**であり、
上辺は画面の縁のままだから。

```
直す前の考え   小さい面 = 接している / 広がった面 = 浮く   （大きさで分ける）
測って出た答え Dock = 接している / Workspace = 浮く        （接しているかで分ける）
```

`DockPresentation.elevation`（状態ごとの高さ）は消した。
`Elevation.attached` / `.floating` の 2 つだけにして、
Dock は全状態で `.attached`、Workspace と Main は `.floating` のまま。

Workspace の影は**測っていない**。画面の中央に置かれた窓で、
macOS の作法どおり浮いてよいはずだが、証拠は無いので触らない。

## ゲートにした

`--selftest dock8` に足した。**宣言ではなく窓に訊く。**

```
画面の上辺に接している（frame.maxY == screen.maxY）窓が
hasShadow を持っていたら FAIL
```

`wantsShadow` を `true` に固定して落ちることを確かめた。

```
壊した状態  SELFTEST_FAIL dock8: 画面上端に接した Dock に窓の影が付いている 220x44
直した状態  SELFTEST_OK dock8
```

※ Judge 3（Haiku）は 2 回とも観察を作り話で埋めた
（craft11「title の下線の幅が違う」/ craft12「角丸の大きさが違う」）。
実際の違いは影だけ。この採点者の観察は採らなかったが、
好みは 2 回とも他の 2 人と同じ側だったので票としては残している。

---

# 結び — 9 段を終えて。**局所の造形はここで打ち切る**

## 採用 4 / revert 5

|                  | 内容                       | 結果                             |
| ---------------- | -------------------------- | -------------------------------- |
| ① 際立ち         | 実行=brand 色・直す=静かに | revert（control_visibility 0-3） |
| ② 字面の階層     | 警告を題の下の独立した段へ | **採用**（visual_craft 3/3）     |
| ③ 行の揃い       | 面の高さを推定式→実寸和    | **採用**（286→229pt）            |
| ④ 意味のある余白 | 群の中を詰め間を空ける     | revert（tie 3）                  |
| ⑤ ボタンの寸法   | 主たる操作に最小幅 96pt    | **採用**（68→96pt）              |
| ⑥ 境界の線       | 中身と操作の間に白 10%     | revert（3 人とも「線は無い」）   |
| ⑦ 角丸           | 柔らかく / 硬く            | revert（2 人が cannot tell）     |
| ⑧ 影・奥行き     | 接した面は浮かせない       | **採用**（3/3、C 案は棄却）      |
| ⑨ 図形の重さ     | 説明 < 押せる < 重い       | **採用**（0.3% 差 → 33% 差）     |

**採用されたものは全部、構造か寸法の誤りを直したもの。**
飾りを足した ④⑥⑦ は 3 つとも動かなかった。

## そして、測り直したら craft は下がった

`sample10` で action_confirmation を VoiceOS の確認カードと測り直した。

```
◎ parameter_hierarchy    astra 3 : voiceos 0
◎ preview_readability    astra 3 : voiceos 0
◎ error_prevention       astra 3 : voiceos 0
◎ provenance_visibility  astra 3 : voiceos 0
◎ control_visibility     astra 2 : voiceos 0  (tie 1)
△ action_clarity         tie 3
× screen_occupation      astra 1 : voiceos 2
× visual_craft           astra 0 : voiceos 3   ← 引き分け(1:1:1) から負けへ
```

**中身では 4 軸を 3:0 で取り、造形で 0:3 で落ちた。**
しかも Astra のほうが情報は多い（チャンネル・差出人・省略しない本文・
どの会議の誰の発言かまで）。500x200 に対し 560x229。

## 負けた理由は、私が 9 段で触ってきた場所には無い

3 人の言い分が揃っている。

> A「rounded card、**generous padding**、centered icon/button treatment が polished」
> B「**elevated card**、rounded corners、**gradient dark surface**、**colorful brand icon**、
> generous padding、**two clearly-chromed buttons**（filled + outlined）。
> E7D5 は行が多く間隔が詰まっていて、Cancel/Edit は**ただの文字**」
> C「refined spacing、optical balance in button sizing、modern type hierarchy」

挙がっているのは 5 つ。

```
1  面が浮いている（elevation）
2  地が gradient（素材）
3  アプリの図形が彩色されている
4  余白が広い（density）
5  副の操作にも枠がある（chrome）
```

**どれも部品の調整では届かない。** そして 1 と 4 は、
⑧ と ③ で私が**逆向きに動かしたもの**でもある。

```
⑧  影を外した      → 3/3「画面の一部に見える」   ／ 競合比では「浮いていない = craft が低い」
③  57pt 詰めた     → 穴が消えて律動が揃った      ／ 競合比では「詰まっている = craft が低い」
```

**矛盾ではない。別の問いに、別の正しい答えが出ている。**
⑧ が答えたのは「Astra は画面に付属するものか、浮遊するアプリか」。
sample10 が答えたのは「作法どおりのカードとして磨かれて見えるか」。
前者は製品の思想で、後者は視覚の語彙。9 段では後者に届かない。

## ここで止める

局所部品の調整はこれで終わり。残っているのは Astra 全体の視覚の文法 ——
surface composition / typographic rhythm / density / 素材感 —— であり、
6 つの型を横断して決める話。次はそこへ移る。

**測り方は残す。** 観察を先に訊き棄権を許す形（`JUDGE_PROMPT.md`）、
面積・間隔・当たり判定は機械が出すこと（`occupation.py` / `alignment.py` /
`primary.py`）、ゲートは壊して落ちることを確かめてから入れること。
9 段のうち 5 段で revert できたのは、この 3 つがあったから。

---

# DS-01〜05 — 視覚の文法を 6 つの型で横断して決めた

結びで「次はそこへ移る」と書いた先。部品ではなく規則を 4 つ決め、最後に
型 6 種を測り直した。規則の正本は `docs/DESIGN_SYSTEM.md`。

|                           | 規則                                                            | 決め方                                                                   | 結果                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| DS-01 surface composition | 面の高さ = 中身の実寸 + inset。推定式を持たない                 | 描いて測る（`DockContentMeasure`）                                       | listening 120→71 / thinking 88→43 / result 150→122（DS-01 時点。DS-03 の padV 16 で listening は 79）。空きが面の 40〜60% を占めていた |
| DS-02 typographic rhythm  | 窓は `type` の 9 段、Dock は `dockType` の 6 段からしか取らない | lint（`lint-type-literals.mjs`、HEAD で 76 箇所落ちるのを見せてから 0）  | Workspace の 9 段 → 6 段、Dock の題 18/19/20 → 20                                                                                      |
| DS-03 density             | Dock の全状態の縁は `padH` / `padV`。縁は行間より広い           | 実測（縁 12〜13 vs 行間 11.7 / 競合 20〜28 vs 9.5）→ 盲検 A/B（craft13） | padV 12→16。幅 520 は本文が折れて面積が減らず、測定で棄却                                                                              |
| DS-04 素材感              | 地は平らな black 0.80。gradient は付けない                      | 盲検 3 名（craft14）、輝度差 10〜16/255                                  | 3 名とも A/B/C を cannot tell。不採用                                                                                                  |
| DS-05 再採点              | —                                                               | sample11〜16、opus + sonnet、観察先行                                    | 下表                                                                                                                                   |

## DS-05 の結果（有効 5 型、1 型 = 1 票）

```
                        sample01-10   sample11-16
visual_craft               2/6   →      3/5
information_hierarchy      5/6   →      4/4
state_legibility           6/6   →      3/3   （1 型 cannot tell）
provenance_visibility      4/6   →      4/5
surface_fragmentation      1/6   →      3/4
control_visibility         5/6   →      3/5
visual_density             3/6   →      2/4
screen_occupation          2/6   →      1/5   （3 型 cannot tell）
```

action_confirmation は確認用 8 軸で **Astra 6 / VoiceOS 0 / 引分 1**。
sample10 で 0:3 だった visual_craft は opus が Astra、sonnet が tie。

## 前回と単純に比べてはいけない 3 点

1. **transcript_attribution は無効**。競合の絵が空の白いパネルだった
   （sample08 も同じ絵）。前回の 6/1 は勝ちではない。
2. **post_meeting は同じ絵で 4/2 → 2/5**（pixel diff 0）。2 名 panel の揺れは
   ±3 軸ある。1 型の数字は単独で読まない。
3. 判定者の顔ぶれが違う（前回 A/B/C、今回 opus/sonnet）。

## sample10 の 5 つの負け筋は、判定者の弁から消えた

```
面が浮いている / 地が gradient / アプリ図形が彩色 / 余白が広い / 副操作に枠
```

今回 craft を落とした 2 型の理由はどれでもない。meeting_controller は切り抜きが
「録音中」の文字を落として波形が孤立して見えた（標本の作り方）、post_meeting は
fixture の中身が 3 行で下半分が空（中身の量）。**DS-01〜03 は構造と寸法の規則で、
それが craft の負け筋を消した。** DS-04 の飾りは何も足していない。
9 段の結論 —— 飾って良くならず、構造と寸法で良くなる —— は 6 型でも同じだった。

## ここからの課題（DS の外）

```
post_meeting         詳細画面に戻る手段が無い / fixture の中身が薄い   → 547dd40（戻る chevron・sidebar で出られる・発言 8 行）→ sample19（Astra 4 / 競合 2 / 引分 2、前 2/5。craft 2 名一致）
meeting_controller   標本の切り抜きに「録音中」を含める（900x120 → 左端から） → sample17（Astra 4 / 競合 1 / 引分 2、craft 引分）
transcript_attribution  競合素材を取り直す                              → sample18（動画 webp の 30 コマ目。5 軸で Astra 3 / 競合 1 / 引分 1）
screen_occupation    judge では測れない。寸法上限の selftest で見る     → --selftest occupation（DESIGN_SYSTEM §7）
```

sample17 は競合画像が byte 一致なのに provenance と density が動いた。2 名 panel の
±2〜3 軸の揺れは同じ絵でも出る。craft の opus 票は「文字と波形の高さが不揃い」で、
画素では両方 y=79〜92 だったので棄却（観察が実測と矛盾した判定者は捨てる）。

---

# 磨きの 7 チケットのあと — 型 6 種で確かめた（Sample 20）

DS-05 の結びで残した課題を 4 つ片付け（sample17/18/19）、そのあと機能を足さずに
面を磨く 5 コミットを入れた。何を直したかと、それが 6 型の採点をどう動かしたか。

| commit  | 直したこと                                                                             | 測った寸法                                |
| ------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| 516720c | 全面で日本語に揃える                                                                   | —                                         |
| 5d97f90 | Meeting Notes の面を `DockContentMeasure` の実寸にする（確認・結果と同じ規則）         | 4 件で 820x460 → 820x357                  |
| d9d9f36 | Workspace 右下の 4 ボタンを消し、入力欄の中の 3 chip（要約 / 決定事項 / アクション）に | 面の空きが +2.3pt、density 基準を書き換え |
| 0e08dcc | Home の復旧行を hairline の一段下に落とす（塗りを外す）                                | 06 +5.6pt / 12 +5.7pt、同上               |
| da0bd80 | Agent Dock に PLAN / CONTEXT の見出し、面の中の影 3 箇所を外す                         | 03-task-dock 271 → 291（上限 298）        |

## Sample 20 の結果（6 型、競合は DS-05 の素材と byte 一致）

```
                        DS-05 最終   Sample 20
visual_craft               5/6   →      5/6    （ctrl は 2 回とも割れて引分）
information_hierarchy      5/5   →      5/5
state_legibility           5/5   →      4/5    （post が 1 票 → tie·ct）
provenance_visibility      5/6   →      5/6    （ctrl が ct → 競合 1 票）
surface_fragmentation      3/5   →      3/5
control_visibility         4/6   →      5/6    （live・ctrl が tie → Astra 1 票、post が tie → 競合 1 票）
visual_density             2/5   →      2/5
screen_occupation          1/6   →      0/6    （judge では測れない軸。寸法は --selftest occupation）
合計                      33/4   →     32/7
```

**5 コミットはどの型も落としていない。** 動いた軸の弁はどれも今回の変更（Notes の高さ・
3 chip・復旧行・影・文言）を指しておらず、同じ絵で ±2〜3 軸ぶれる panel の範囲に収まる。
craft の弁は画素で 1 つ確かめた（captions の発言 3 行の左端 x=794 で全行一致）。

## 残っているもの

```
surface_fragmentation  post / attr で 2 名一致の負け。sidebar + 本文 + inspector の 3 列と、
                       上に浮く Dock を「別の窓」と読まれる。§7.1 の構成そのもの
screen_occupation      窓だけの撮影 vs 壁紙の上の小窓。judge には測れない。寸法ゲートで見る
visual_density         Workspace の左カード下半分が空（attr / ctrl）。fixture の量ではなく面の高さ
```

飾りを足した回は一つもなく、面の高さ・段差・影の有無・文言だけを動かした。
9 段と DS-01〜05 の結論 —— 飾って良くならず、構造と寸法で良くなる —— は、
磨きの回でも崩れなかった。

# 横展開② — Library の階層（craftL）

批評 5「Library は全体が淡く、目を細めると同じ灰色の塊」。weight（要約を medium）と
色（話者を accent → muted）の 2 レバーを A/B/C で伏せて訊いた（`compare/craftL`）。

```
                 要約の暗画素   本文列の accent 画素   有効 3 名の採用
A HEAD              1199            1044                 0
B 要約 medium       1422 (+19%)     1044                 0
C B + 話者 muted    1422             353 (−66%)          3
```

入れたのは色だけ。weight は 3 名中 2 名が見えず（DS-02 の隣り合う 2 段の差は知覚の下）、
§5 に積んだ。R2「最初に目が行く場所」が A/B の「名前の列」から C の「題」へ移った。
色を減らして段が立った回であり、9 段からの結論はここでも同じ。
