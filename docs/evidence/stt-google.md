# Google STT 実接続の証跡

`astra-production-506721` / ADC（`gcloud auth application-default login`）。
**代役ではない。**すべて Astra の provider 経由で測ったもの。

音声: ReazonSpeech モデル同梱の `test_wavs/5.wav`（14.0 秒・日本語・1 名）

## 1. Batch（Final Accuracy Path、正本 §11.2）

| location | model              | 時間   | 話者                      | 結果                                                                              |
| -------- | ------------------ | ------ | ------------------------- | --------------------------------------------------------------------------------- |
| `us`     | `chirp_3`          | 5428ms | **speaker 1**（分離あり） | 「持ち主とはぐれた傘が風で舞い看板もなぎ倒されてしまったようです。」 1600-11120ms |
| `global` | `long`（fallback） | 1930ms | null                      | 2 分割・文が途切れる                                                              |

- Chirp 3 は **`us` / `eu` の multi-region**。`global` / `asia-northeast1` /
  `us-central1` には無い（`does not exist in the location`）
- `us` のほうが**文も正確**で、語単位の時刻と話者分離が付く

## 2. Streaming（Live Path、正本 §11.2）

同じ音声を 100ms ずつ送信。

| model     | 途中経過  | 最初の途中経過 | 確定 |
| --------- | --------- | -------------- | ---- |
| `chirp_3` | **0 件**  | —              | 2 件 |
| `long`    | **26 件** | 2760ms         | 2 件 |

**Chirp 3 は streaming で途中経過を返さない。**
会議中は確定まで画面に何も出ないことになり、§12.4 の live transcript が
成り立たない。→ **live は `long`、精度は batch の Chirp 3** に分けた。

Chirp 3 streaming は語単位の時刻も断る:

```text
Chirp 3 only supports word timestamps in Recognize and BatchRecognize requests.
```

## 3. 出所（provenance）

streaming の結果に `source` が載ることを確認:

```text
FINAL src=microphone spk=null provider=long fb=false 「持ち主とはぐれた傘が風で舞い。」
```

話者分離が無くても **`source` は残る**（正本 §11.3・§12.2 の一次情報）。

## 4. §23 の実測

| 指標                                      | 実測         | 予算  | 判定     |
| ----------------------------------------- | ------------ | ----- | -------- |
| `meetingLiveTranscript`（最初の途中経過） | **2760ms**   | 900ms | **OVER** |
| batch 全体（14 秒の音声）                 | 1930〜5428ms | —     | 参考     |

live の 2760ms は、送信間隔 100ms と Google 側の確定待ちを含む。
**900ms には届いていない。**縮めるには、送信間隔を詰めるか、
別の live provider（手元の認識）を併用するかになる。

## 5. 実接続でしか出なかった不具合

| 症状                           | 原因                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 403 `RESOURCE_PROJECT_INVALID` | gRPC は `quotaProjectId` が要る（REST の `x-goog-user-project` に相当）                                                                      |
| `Invalid resource field value` | SDK の public `streamingRecognize` は **V1 向けの shim**。V2 は `recognizer` を全メッセージに載せ、音声は `audio`（`audioContent` ではない） |
| 時刻が全部 0                   | SDK は `{seconds,nanos}`、REST は `"4.870s"`。文字列を読めていなかった                                                                       |
| 音声が無音として通る           | REST は base64。バイト列のまま送ると `{"0":82,...}` になり、**落ちずに無音になる**                                                           |
| Chirp 3 が「無い」             | location ごとに endpoint が違う（`us-speech.googleapis.com`）                                                                                |
