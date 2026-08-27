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
