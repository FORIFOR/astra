# PERCEIVED_SURFACE_CONTINUITY — 集計（2026-09-05）

判定者 4 名を回し、fixture 検証を通った **3 名**（j1 opus / j2 sonnet / j4 fable）で集計。
j3 haiku は無効（F-diff を same と答え、8A57 の観察に画像に無い文字を書いた）。規則は `protocol.md`。

## fixture 検証（3 名とも通過）

| fixture | 期待 | j1 | j2 | j4 |
| --- | --- | --- | --- | --- |
| A110 F-same | continuous | continuous / same | continuous / same | continuous / same |
| F3B0 F-diff | switched | switched / different | switched / different | switched / different |
| 35E9 F-jump | switched | switched / cannot tell | switched / cannot tell | switched / cannot tell |

## 本物

| | j1 opus | j2 sonnet | j4 fable | 数 |
| --- | --- | --- | --- | --- |
| **T1 meeting→notes** feel | continuous | switched | switched | continuous **1 / 3** |
| T1 same_surface | same | same | cannot tell | same 2 / 3 |
| T1 top_edge | fixed | moved | fixed | fixed 2 / 3 |
| T1 vanish | yes（コマ 3、コマ 2 も） | yes（コマ 3） | yes（コマ 3、コマ 2 も） | **yes 3 / 3** |
| **T2 notes→workspace** feel | continuous | switched | switched | continuous 1 / 3 |
| T2 same_surface | same | same | same | **same 3 / 3** |
| T2 top_edge | fixed | fixed | fixed | **fixed 3 / 3** |
| T2 second_surface | yes-first-stays | yes-first-stays | yes-first-stays | **first-stays 3 / 3** |

## 読み方

- **T1 は FAIL（Evidence B）。** 3 名全員が「コマ 3 で全面が真っ黒、コマ 2 も板が沈む」を観察し、
  2 名がそれを理由に「切り替わった」と感じた。層 A の実測（`surfacemotion`: 上辺 0.0pt、窓 +0、
  fade ≤ 9.3/255 per frame）は通っているが、**中身が 100–300ms 消える**（`contentVisible` の fade、
  PHASE2-JOURNEY 層 C に記録済み）が知覚では「別物が載った」に読まれる。j2 の「上の縁が動いた」も、
  コマ 2 で窓が中身より低く、見出しが上で切れて見える（実 frame）ことに由来する。
- **T2 は設計どおり。** 3 名とも「1 枚目はそのまま残り、上の縁は動かず、その下に 2 枚目が開いた」。
  feel は 2 名が switched だが、これは「同じ面が広がった / 画面が切り替わった」の二択に
  「1 枚目を残して 2 枚目が開く」が収まらないため（protocol.md の注記どおり）。連続性の欠陥ではない。
- 直すなら（本人の判断待ち）: T1 で **変わらない見出し（録音中・メモ・字幕・Ask Astra）を morph 中に
  消さない**。`VoiceHUDView.contentVisible` が mode 変化で全体を 0 にしているのを、変わる部分だけに
  限る。Motion の規則（`dockContentDelayMs`）と `dockanim` gate に触るので、Craft Freeze の外か内かは本人が決める。

## 修正後の再判定（2026-09-05、本人の「直してください」の後）

修正: `.meeting` → `.meeting` の遷移で全体 fade を掛けず、開閉する板だけを同じ間合いで出す（見出しは消さない）。
同じ prompt・同じ fixture、本物 2 本だけ修正後の frame（`surfacemotion` 再撮影）で作り直した。修正前の絵は
`images/before-fix/` に残してある。判定者は新規 4 名、fixture 検証を通った **3 名**（k1 opus / k3 fable / k4 opus）で集計。
k2 sonnet は無効（F-jump を「位置は変わらず文字だけ変わった」と読んで continuous、観察に画像に無い文字）。

| | k1 opus | k3 fable | k4 opus | 数（修正前） |
| --- | --- | --- | --- | --- |
| **T1 meeting→notes** feel | continuous | continuous | continuous | continuous **3 / 3**（1 / 3） |
| T1 vanish | cannot tell（コマ 1） | none | cannot tell（コマ 1） | 「真っ黒」の観察 0 / 3（3 / 3） |
| T1 top_edge | fixed | cannot tell | fixed | fixed 2 / 3 |
| T2 notes→workspace feel | continuous | switched | continuous | continuous 2 / 3（1 / 3） |
| T2 second_surface | yes-first-stays | yes-first-stays | yes-first-stays | **first-stays 3 / 3** |
| T2 top_edge | fixed | fixed | fixed | **fixed 3 / 3** |

**T1 は PASS。** 3 名とも「同じ見出しが残ったまま下に足されていく」と観察し、修正前に 3 名全員が書いた
「コマ 3 で全面が真っ黒」は誰も書かなくなった。層 A の contentΔmax も 9.3 → 5.1 / frame。
残る層 C はコマ 1（最初の 1 tick、窓が中身より低く見出しが上で切れる）で、2 名が vanish を「cannot tell」と
した理由。欠陥の信号としては弱い（「切り替わった」とは誰も読まない）ので記録に留める。
T2 は変えていない。k3 は修正前の fable と同じく「新しい面が一度に開く」を switched と読むが、
1 枚目が残る・上辺不動は 3 / 3 で設計どおり。
