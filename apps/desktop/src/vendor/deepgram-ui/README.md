# vendor/deepgram-ui

Deepgram 公式 `@deepgram/ui`（MIT）から、**描画だけ**を持ち込んだもの。

| ファイル           | 出所                                          | 扱い                                                            |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------- |
| `Orb.tsx`          | `packages/ui/src/components/Orb.tsx`          | ほぼそのまま。`noUncheckedIndexedAccess` のための null 対策だけ |
| `LiveWaveform.tsx` | `packages/ui/src/components/LiveWaveform.tsx` | そのまま                                                        |
| `LICENSE`          | リポジトリ root                               | 原文                                                            |

取得元: https://github.com/deepgram/ui （2026-08-27 時点の `main`）

**持ち込んでいないもの**: VoiceButton（状態の型が違うので書き直す）、
AgentProvider / WebSocket / microphone（Deepgram API 前提。Astra は
Google STT / TTS と Local Agent Host を使う）。

書式は repo の Prettier に合わせて整形してある。ロジックは変えていない。
Astra 側の adapter は `src/voice/` にある。

## どこまで Deepgram の作法を取り込んだか（2026-08-27）

| Deepgram の要素                                                                   | Astra での扱い                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Orb` / `LiveWaveform`                                                            | そのまま（色だけ Astra の accent）。Dock の行と Voice HUD で描画                                 |
| floating-orb: **Orb が入口**、idle → connecting → listening → thinking → speaking | Dock 左端の Orb ボタン（`.astra-dock__orb`）。姿は `dockVoiceMode()` で対話状態と runtime を畳む |
| `AgentMicrophoneButton` の lucide マイク                                          | `voice/MicIcon.tsx`（絵文字を廃止、状態で色が変わる）                                            |
| dark scheme（#18181c / #222228 / #1e1e24 / #8b8b9a / border .08）                 | `@astra/ui-kit` の `floatingSurface` → `--astra-float-*`。Dock と HUD だけが使う                 |
| カードの高さが状態と繋がって動く                                                  | CSS の enter animation + Rust 側で window を 6 段で寄せる（`dock::morph`）                       |
| brand の緑 `#13ef93`                                                              | **取らない**。accent は §17.1 のまま                                                             |

### 見た目の確認（開発ビルドのみ）

`#/dock?demo=ready|listening|thinking|speaking|connecting|error` と
`#/voice-hud?demo=listening|speaking|thinking` で、マイク無しに各状態を固定して描ける。
音量は合成（`voice/demo.ts`）。本番ビルドでは効かない。

### 参考リポジトリ（`deepgram/ui` のソース）から追加で取り込んだもの（2026-08-27）

| Deepgram の要素                                                                                 | Astra での扱い                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Response`（依存なしの markdown 描画）                                                          | `vendor/deepgram-ui/Response.tsx`。解析はそのまま、装いは Astra の CSS。Dock の答えに使う                                                                    |
| `VoiceButton` の状態の配分（listening = 輪、speaking = 塗り + ゆっくり脈、connecting = 速い脈） | Dock のマイクに同じ配分                                                                                                                                      |
| `MicSelector`（入力装置の列挙）                                                                 | Rust の `audio_input_devices` を露出し、会議の開始確認で「使うマイク」を表示。**選択して切り替える経路はまだ無い**（会議の音声はゲートウェイ側の経路のため） |
| `BarVisualizer`                                                                                 | 取り込まない。会議の音量は Rust から画面へ流れておらず、動かない meter を置かない                                                                            |
