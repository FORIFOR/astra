# Astra UX の 6 原則

**迷ったらここへ戻る。** どれかを破る変更は、破る理由を書いてから入れる。

VoiceOS の写しと SuperIntern の写しを足しても、最も優れた UI にはならない。
Astra が強くなるのは、片方では Voice Agent、片方では Meeting Agent だったものが、
**一つの Ambient Work Surface** になるところ。

---

## 1. INVISIBLE UNTIL NEEDED

必要ない時は作業領域を奪わない。

存在の大きさが要る量に比例する: 何も無い → Dock → 開く → Workspace。
勝手に前へ出ない。焦点を奪わない。

- 検査: `scripts/verify-focus-steal.sh` / Journey の `focusTheft` と `windowsOpened`
- 反例: 起動しただけで権限を 4 つ聞く（直した。J08）

## 2. ONE SURFACE

Voice / Task / Meeting / AI を、不必要に別の窓へ割らない。

同じ面が姿を変える。上辺の位置を保ったまま大きさと役割が変わる。

- 検査: Journey の `windowsOpened = 0`、Dock の morph 実寸
- 反例: 会議を開くと別窓が増える

## 3. ZERO BLANK STATE

待っている間も、いまの状態と次に起こることを伝える。

**ただし偽の skeleton は置かない。** 無いものは「待っています」と言う。
中身があるように見せる灰色の箱は、嘘の一種。

- 検査: J05 の地の割合（絵で測る。データが空かどうかで測らない）
- 反例: 会議開始 0 秒で真っ白（直した。J05）

## 4. SHOW ACTION, NOT THOUGHT

AI の内部思考を読ませない。**何をしているか・何をしたか**を出す。

```
✓ Calendar を読んだ
○ 承認を待っている   [確認する]
```

ではなく「予定を検討しています…」のような独り言を流さない。

- 反例: 思考の実況。読んでも何も決められない

## 5. EVERYTHING AI-GENERATED IS VERIFIABLE

AI が作ったものには、可能な限り source / speaker / timestamp を持たせる。

拾った行を押せば、その発言の前後の文字起こしが開く。
**辿れない出所は出所ではない。** 付いているだけで開けないなら、信じるしかない点は変わらない。

- 検査: J09（出所の付与率と、実際に開けるか）
- できていないこと: その時刻の音声へ戻る（再生が未実装。**飾りのボタンは置かない**）

## 6. CORRECTION AT THE POINT OF ERROR

間違いを見つけた場所で、直せる・取り消せる。

別画面へ移動させない。直しても出所（誰・いつ）は残す
——文言だけ直して誰の発言か消えるなら、直すたびに根拠を失う。

- 検査: J09（その場で直す／これは違う）

---

## 使い方

UI を変えるときは、その変更がどの原則に効くかを書く。
どれにも効かないなら、入れる理由を別に説明する。

定性評価（`docs/ux-benchmark/qualitative/`）の 10 軸は、この 6 原則を
人が感じ取れるかを測るもの。原則 → 軸の対応:

| 原則                       | 効く軸               |
| -------------------------- | -------------------- |
| 1 INVISIBLE UNTIL NEEDED   | Calmness             |
| 2 ONE SURFACE              | Continuity           |
| 3 ZERO BLANK STATE         | Clarity / Hierarchy  |
| 4 SHOW ACTION, NOT THOUGHT | Trust / Control      |
| 5 VERIFIABLE               | Trust / Context      |
| 6 CORRECTION AT THE POINT  | Control / Efficiency |
