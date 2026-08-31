# Screenshot Reality Gate

**コードレビューより先に、実際に表示された画面を正解とする。**

コードを直しただけでは完了にしない。直したあとに撮り直して、基準と突き合わせる。
ここに書いてあるものは全部 `pnpm verify:all` で回る。

---

## 1. 何を正解とするか

| 種類 | 置き場所 | 何を保証するか |
| --- | --- | --- |
| 正解画像 | `docs/golden-screenshots/task-dock/`（13面・light/dark） | 見た目 |
| **実寸** | `docs/golden-screenshots/geometry/`（6状態・JSON） | 位置・寸法（pt） |
| 密度の基準 | `docs/evidence/density-baseline.json` | 空きすぎていないか |

画像は「違う」ことしか言えない。**どれだけ違うかは実寸で見る。**

---

## 2. 6 状態

`--selftest geometry` が測る単位。正解画像の名前と揃えてある。

```
01-idle          Idle Dock
02-listening     Listening
03-task-dock     Task Dock Expanded
04-meeting       Meeting Dock
05-meeting-notes Meeting Notes / Captions / Ask Astra
06-workspace     Full Workspace
```

---

## 2.5 Dock の中身も測れる

SwiftUI は `.accessibilityLabel` を container に付けると**全体を 1 要素に畳む**。
そのため当初は Dock 全体で 1 個・96x76 しか取れず、中の行やボタンが見えなかった
（96x19 はラベルの寸法で、Dock の寸法ですらなかった）。

`.accessibilityElement(children: .contain)` に変えて、中の操作が AX に出るようにした。
VoiceOver から見ても、複数の操作を持つ面を 1 つの読み上げにするのは誤りなので、
測定の都合ではなく本来の形。

```
01-idle           3 要素
02-listening      4
03-task-dock      9   ← step-* の行、progress、Stop、Continue
04-meeting        8   ← Notes / Captions / Ask / secret / Stop
05-meeting-notes  9
06-workspace     16
```

---

## 2.6 文字の行位置も測る

`AXStaticText` の枠をそのまま取る。**本文へ識別子を足す必要はなかった**
（container を `.contain` にしたことで、中の文字も AX に出るようになったため）。

鍵は `text:<文言>`。Task Dock の実測:

```
text:Astra / Working        y=14.0   ← 見出し行は 4 つとも揃っている
text:週次ブリーフィングを作る   y=42.0
text:Calendar               y=101.5
text:Gmail                  y=137.5  ← ピッチ 36pt ちょうど
text:Notion                 y=173.5
```

アイコンで測ると 35/36 とばらついて見えるが、それはグリフ固有の差。
**行の位置は文字で測る。**

経過時間（`00:00`）や進み具合（`50%`）は撮るたびに変わるので、
**数字と記号だけの文言は基準にしない**（毎回「無い要素」になってゲートが嘘をつく）。
語が入っていれば使う。6 状態を 2 回記録して、すべて同一になることを確かめてある。

---

## 2.7 焦点を奪わないこと

常駐して姿を変える面は、出るたびに他アプリの入力を横取りすると使い物にならない。
`.nonactivatingPanel` と `canBecomeKey = false` は宣言してあったが、
**宣言だけでは効いたことにならない**ので `--selftest focus` で実測する。

Finder を前面にしてから Dock を出し、Listening → Agent → 会議 → Notes と
姿を変えて、そのあいだ前面のアプリが変わらないことを見る。

作る過程で 2 回、**落ちないゲート**を書いた:

1. 出しただけを見ていた。`.nonactivatingPanel` を外して `canBecomeKey = true` に
   しても通ってしまった。`.accessory` のアプリでは、窓を key にしても前面は変わらない。
2. そこで `makeKeyAndOrderFront` を総当たりで呼んだら、今度は Ask 用の面
   （key になってよい面）まで「奪った」と言い出した。製品がしない操作を試して
   落とすのは誤り。

実際に奪う経路は `NSApp.activate`。`showVoiceHUD` に仕込んだら 5 段すべてで
検出できたので、いまの形は効いている。

---

## 3. 直す順番（機械が強制する）

```
① Geometry     位置・寸法
② Spacing      間隔
③ Typography   行位置
④ Surface      面の見え
```

**上の段に差があるうちは、下の段を報告しない。**
色や影を延々直しているのに面の幅が 30pt 違う、という直し方を防ぐため。
`UIGeometry.compare` がこの順で返す。

外枠から見る（VoiceOS 系で最も壊れやすいのは中身ではなく Panel）:

```
Window level → 位置 → 幅・高さ → 影 → 背景 → 角丸 → hit testing → 中身
```

---

## 4. 判定の数値

| 見るもの | 許容 | 測り方 |
| --- | --- | --- |
| 窓の位置・寸法 | **2pt** | `--selftest geometry` |
| 中央からのずれ | **2pt** | 同上（`:centerOffset`） |
| 上辺から画面上端 | **2pt** | 同上 |
| 同じ種類の行の**隙間** | **2pt** | 同上（`② Spacing`） |
| 同じ種類の行の**端** | **2pt** | 同上 |
| **文字の行位置**（baseline） | **2pt** | 同上（`text:<文言>`） |
| 見た目 | 0.5%（縮小グレースケール） | `--selftest golden` |
| 面の空き | 基準 +1.5pt 以内 | `--selftest density` |
| 焦点を奪わない | 前面アプリが変わらない | `--selftest focus` |

**外れたら差分画像が残る**: `<撮影先>/diff/<面>-diff.png`
（基準｜実際｜差分 の 3 面並び。違う画素を赤で塗る）

「1.08% 違う」だけでは直しようがないので、必ず開ける形にしておく。

---

## 5. 「AI が作った感」の上限

`scripts/verify-ui-taste.sh`。数の**天井**で見る。減らすのは自由、増やすなら理由を書く。

```
gradient          0     Astra には要らない
角丸 >28pt        0     tokens の範囲で足りる
material/blur     8     地は 1 つで足りる
sparkles          6     AI らしさの飾りにしない
Capsule          20     何でも Pill にしない
shadow            9     面を浮かせすぎない
40字超の文言      6     画面は読ませる場所ではない
```

上限は 2026-09-01 時点の数。**正しい数ではなく、そこから増やさないための天井。**

---

## 6. 基準を更新するとき

意図して変えたときだけ。撮り直しは「直した証拠」ではなく「新しい正解の宣言」。

```sh
# 実寸
apps/astra-macos/.build/debug/AstraMac --selftest geometry docs/golden-screenshots/geometry --record

# 正解画像
apps/astra-macos/.build/debug/AstraMac --selftest dock8 /tmp/d && cp /tmp/d/*.png docs/golden-screenshots/task-dock/
```

コミットには**何を変えたのでこの値になったか**を書く。書けないなら、それは意図した変更ではない。

---

## 7. まだ機械で見ていないもの

正直に書いておく。ここは人が見る。

- **hover / press / focus は画素差でしか見ない**（`--selftest states`）。
  pt で測ろうとして、できないことが分かった —— `pressedScale = 0.97` は
  `scaleEffect` による**描画の変形**で、AX の枠は変わらない。
  実寸で見ようとしたゲートは「1.000 倍（0.97 のはず）」と必ず落ちる。
  測れない性質にゲートを置かない。ここは画素差が正しい道具。
- **操作の手触りのうち、人が触る部分**: Dock がジャンプしないか、
  他アプリの作業を邪魔しないか。焦点については下記のとおり機械化した。
- **格子**（2 列の AI 操作など）の並びは見ていない。行と列の意図を推し量れないので、
  誤って「ばらついた」と言うより見ないほうがよいと判断した
- **格子**（2 列の AI 操作など）の並びは見ていない。行と列の意図を推し量れないので、
  誤って「ばらついた」と言うより見ないほうがよいと判断した
