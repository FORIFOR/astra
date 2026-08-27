# 通しの実測 — 代役なし

2026-08-27。`GOOGLE_CLOUD_PROJECT=astra-production-506721`、ADC 経由。
音は Google TTS で作った（外部の録音を持ち込まずに、実音声で通すため）。

---

## 1. Voice → STT → Agent → Search → TTS

| 段                     | 時間            | 結果                                                            |
| ---------------------- | --------------- | --------------------------------------------------------------- |
| Voice（TTS）           | 451ms           | 197,352B / `audio/l16; rate=16000`                              |
| STT（batch, chirp_3）  | 3,389ms         | 「東京エレクトロンの2025年3月期の売り上げ高を調べてください。」 |
| Search（端末）         | 15,779ms        | 出典 3 件                                                       |
| 抽出 ×2                | 5,554 / 6,742ms | 主張を採取                                                      |
| 統合                   | 5,167ms         | 結論 3 件、**全て根拠つき**                                     |
| Reply（TTS）           | 1,502ms         | 1,005,406B                                                      |
| 翻訳（Translation v3） | 404ms           | 英訳                                                            |

出た答え:

> 東京エレクトロンの2025年3月期の売上高は2兆4,315億円で、前期比32.8%の増収。
> 売上総利益は初めて1兆円を超えて1兆1,462億円、売上総利益率47.1%。
> 営業利益は6,973億円で、前期比52.8%の増益。

同社の開示と一致した。**代役は 1 つも通っていない**
（`stt=google-stt-batch standIn=false` / `translate=google-translate-v3`）。

---

## 2. Meeting: mic + system → provenance → refinement → summary

三つの発言を、声を変えて別々に作り、**音源ごとに**起こした。

```
microphone  spk=1  来週の打ち合わせですが、9月3日の15時でいかがでしょうか?
system      spk=1  その日は別件が入っております。9月4日の午前中であれば空いています。
microphone  spk=1  では9月4日の10時にしましょう。議事録は私が用意します。
```

**ここが要点**: 話者分離は 3 つとも `spk=1` を返した。
音源ごとに起こしているので、分離の番号は毎回 1 から振り直される。
**三人が同じ話者に見える。**区別できたのは出所（`source`）だけだった。

束ねたあとも出所は保たれた（`["microphone","system","microphone"]`、
出所を落とした segment は 0）。

端末で作った要約（9,948ms、`standIn=false`）:

```
要点: 来週の打ち合わせとして9月3日15時が提案された。        [seg-0]
要点: 相手は9月3日は別件があり、9月4日の午前中なら空いている。 [seg-1]
決定: 打ち合わせは9月4日10時に行う。                       [seg-2]
やること: 議事録を用意する。(担当 自分（話者1）)             [seg-2]
```

引用 4 件、**跳べないもの 0 件**。
やることの担当が「自分」と出ているのは、`source=microphone` から来ている。
出所を落としていたら、ここは「話者1」としか書けなかった。

---

## この通しで見つけた欠陥

出所は正本 §11.3 で**一次情報**と決まっているのに、
**三層で落ちていた**。通して動かすまで表に出なかった。

| 落ちていた場所                                                      | 何が起きるか                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| batch の起こし直し（`fromV2Results`）が `source` を付けていなかった | 精度優先で起こし直すたび、話者の手掛かりが分離の番号だけになる        |
| `stabilize` が出所を持たず、**出所の違う発言を繋いでいた**          | 自分の発言と相手の発言が 1 つの塊になり、どちらのものとも言えなくなる |
| `meeting_segments` に `source` 列が無かった                         | 保存の時点で消える。起こす側は出していたのに、置く場所が無かった      |

三つとも直し、単体試験で見張るようにした。

---

## capability report（Google を設定した状態）

```
search             real      verified        device (web search)
language_model     real      verified        device (bring your own)
speech_to_text     real      verified        google-stt-v2
translation        real      verified        google-translate-v3
text_to_speech     real      verified        google-tts
image_generation   stand-in  not_configured  deterministic
video_generation   stand-in  not_configured  none
oauth_providers    stand-in  not_configured  none configured
```

必須 5 つのうち **4 つが real + verified**。
残る `oauth_providers` は OAuth Client の作成待ちで、
本番起動は**そこで止まる**（止まるように作ってある）。
