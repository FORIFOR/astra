# DeepNote → Astra: 音声取得とローカル認識の移植

`/Users/horioshuuhei/Projects/deepnote-desktop` を実際に読んだ上での対応表。
**donor implementation として使い、Astra の抽象化・計測契約へ作り直す。**

## 1. 対応表

| DeepNote                        | 内容                                | Astra                            | 判断                      | 理由                                                                                                                            |
| ------------------------------- | ----------------------------------- | -------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `audio/capture.rs`              | cpal 入力・mono 化・16k 変換        | `src-tauri/src/audio/capture.rs` | **rewrite**               | 取り込みは同じ形で足りるが、**frame に出所を付けて返す**必要がある。DeepNote は `Vec<f32>` を裸で渡すので、mix 後に出所が消える |
| `audio/system_capture.rs`       | ScreenCaptureKit 経由のシステム音声 | 同 `system.rs`                   | **rewrite（骨組みのみ）** | Swift bridge を含む 571 行。**今回は口だけ作り、実装は macOS 権限と合わせて次段**。無いことを capability で言う                 |
| `audio/mixer.rs`                | 2 本の mono を加算しクランプ        | `audio/mixer.rs`                 | **reuse（考え方）**       | 25 行。式は正しい。ただし **mix 後に出所を捨てない**形へ変える                                                                  |
| `audio/resampler.rs`            | rubato FftFixedIn、100ms チャンク   | `audio/resampler.rs`             | **reuse（考え方）**       | 契約（入力 N → 出力 M、端数は内部保持）だけ引き継ぐ                                                                             |
| `audio/recorder.rs`             | WAV 書き出し                        | —                                | **reject**                | Astra は `RecordingStore` が既にある（`services/meeting`）。二重に持たない                                                      |
| `audio/cache.rs`                | 音声キャッシュ                      | —                                | **reject**                | DeepNote のセッション模型に依存                                                                                                 |
| `audio/level_meter.rs`          | RMS                                 | `audio/level.rs`                 | **reuse**                 | 31 行。そのままの考え方で足りる                                                                                                 |
| `stt/sherpa.rs`                 | offline recognizer + 疑似ライブ     | `stt/sherpa.rs`                  | **rewrite**               | 後述の理由（§2）で**窓の設計を変える**。FFI の使い方と CString 寿命管理は引き継ぐ                                               |
| `stt/sherpa_ffi.rs`             | C FFI 束縛 1194 行                  | `stt/ffi.rs`                     | **部分 reuse**            | offline recognizer と VAD に要る分だけ写す。translation / online / LID の構造体は持ち込まない                                   |
| `stt/vad.rs`                    | Silero VAD (sherpa)                 | `stt/vad.rs`                     | **reuse**                 | ただし DeepNote は**録音経路で VAD を使っていない**（§2）。Astra は使う                                                         |
| `stt/lid.rs`                    | Whisper tiny による言語判定         | —                                | **defer**                 | 日本語固定で始める。多言語は会議の翻訳と一緒に                                                                                  |
| `stt/cloud_stream.rs`           | 自前 backend への WS                | —                                | **reject**                | Firebase + `/ws/stream/{id}`。Astra の local-first と別物                                                                       |
| `stt/translation_recognizer.rs` | SenseVoice 翻訳 2036 行             | —                                | **defer**                 | 翻訳は provider 契約の向こう側                                                                                                  |
| `stt/path_compat.rs`            | Windows 非 ASCII パス対策           | `stt/path_compat.rs`             | **reuse**                 | 日本語ユーザー名で初期化が落ちる問題は Astra でも起きる                                                                         |
| `commands/model_commands.rs`    | モデルの取得・検証・隔離            | `stt/model.rs`                   | **部分 reuse**            | manifest + sha256 + 破損隔離の考え方は良い。ダウンロード UI は持ち込まない                                                      |
| `commands/audio_commands.rs`    | 録音の起動と ASR スレッド           | `audio/session.rs`               | **rewrite**               | 800 行超。Firebase / cloud / interview mode / 診断ログが混ざっている。**取り込みと認識だけ**を抜く                              |

## 2. そのままコピーしなかった理由

### 2.1 出所（provenance）が mix で消えていた

`audio_commands.rs` はマイクのコールバックの中でシステム音声バッファを drain して混ぜ、
**混ざった `Vec<f32>` だけ**を ASR とレコーダへ渡している。
あとから「この発言はどちらから来たか」を言えない。

Astra は会議の話者対応（§12）と、外へ出す判断（§22）で出所が要る。
`PcmFrame` に `source` を持たせ、**mix したものは `mixed` として別の frame** にする。

### 2.2 ライブ認識が 6 秒窓だった

`push_live_audio` は `WINDOW = 96000`（6.0 秒）・`HOP = 83200`（5.2 秒）で、
**窓が埋まるまで 1 文字も出ない。**

正本 §23 の `localSttFirstPartial` は **p95 350ms**。
6 秒窓では構造的に届かない。窓を縮めれば近づくが、
ReazonSpeech は **offline（非ストリーミング）transducer** なので、
窓を縮めるほど認識が落ちる。

→ **350ms を満たすには streaming zipformer 日本語モデルが要る。**
今回は窓を設定可能にし、実測値を出すところまでを担当する。
**満たせないことを、満たしたことにしない。**

### 2.3 VAD が録音経路で使われていなかった

`stt/vad.rs`（Silero）は存在するが、`audio_commands.rs` の録音経路は通らない。
固定窓で回しているため、無音でも decode が走る。

Astra は VAD を経路に入れる。無音を decode しない分だけ、
`sttDecodeStarted` が意味のある印になる。

### 2.4 診断が `/tmp` への文字列追記だった

`/tmp/deepnote-sherpa.log` などへ `writeln!` している。
§23 を機械で読むには使えない。**構造化した計測**に置き換える。

### 2.5 panic を握って続行していた

ASR スレッドは `catch_unwind` で panic を飲み、poisoned mutex を `into_inner` で回復する。
落ちないのは良いが、**何が起きたかが残らない。**
Astra は typed error にして、capability と task の失敗に載せる。

## 3. 持ち込まないもの

- Firebase / DeepNote backend / `/ws/stream/{session_id}`
- DeepNote の session / account 模型
- サーバ側でベンダ資格情報を持つ形
- `/tmp` への診断ログ
- interview mode などの製品固有分岐

## 4. 実測（2026-08-27、M シリーズ macOS）

実物の sherpa-onnx（`libsherpa-onnx-c-api.dylib`）と
ReazonSpeech 日本語モデルを使い、モデル同梱の `test_wavs/5.wav`（14.0 秒）で測った。
**代役ではない。**再現手順は `stt::recognizer::real`（`--ignored`）。

### 4.1 一括（窓なし）

| 音の長さ | decode         | 結果                                                               |
| -------- | -------------- | ------------------------------------------------------------------ |
| 14.0 秒  | **284〜521ms** | 「持ち主とはぐれた傘が風で舞い看板もなぎ倒されてしまったようです」 |

### 4.2 窓を変えたときの、速さと質の交換

| 窓                        | decode 合計 | 文字数 | 結果                                                                              |
| ------------------------- | ----------- | ------ | --------------------------------------------------------------------------------- |
| 6000ms（DeepNote の既定） | 531ms       | 42     | 「…なぎ倒されてしまったようです**倒れてしまったようです**」（重なりが畳めず二重） |
| 1500ms（Astra の既定）    | 378ms       | 24     | 「えっ持ち主とはぐ傘が風で舞い看板もなぎ倒すえっ何」                              |
| 700ms                     | 301ms       | 19     | 「あっ持ち主れた傘がでもうなぎそうです何」                                        |

**窓を縮めると、速くなるのではなく落ちる。**
decode は速くなるが、認識できる文が短く・崩れていく。

### 4.3 §23 `localSttFirstPartial`（p95 350ms）

| 項目                                   | 実測             |
| -------------------------------------- | ---------------- |
| 最初の途中経過までに要した**音の長さ** | 1500ms（窓ぶん） |
| その時点の decode                      | 43ms             |
| 実機での見込み（音は実時間で届く）     | **1543ms**       |
| §23 の予算                             | 350ms            |
| 判定                                   | **OVER**         |

**この構成では §23 に届かない。**窓を 700ms まで縮めても
音の待ちだけで 700ms あり、予算の 2 倍になる。しかも文が崩れる。

届かせるには **streaming（online）zipformer の日本語モデル**が要る。
手元にある streaming モデルは韓国語と中国語だけで、日本語は無い。

→ `stt.local.japanese` は「使える」と申告するが、
**§23 の `localSttFirstPartial` は `WHY_NOT_MEASURED` のまま**にしてある。
測れるようになったのではなく、**測ったら届かなかった**。

### 4.4 壁時計だけで測ってはいけない

最初に書いた計測は、ファイルから音を流していたので
「最初の途中経過まで 45ms」と出た。**音が実時間より速く届いていただけ**で、
マイクからは 1500ms 待つ。

計測は「音の長さ」と「decode 時間」を分けて出す。
足したものが、実機で利用者が待つ時間になる。
