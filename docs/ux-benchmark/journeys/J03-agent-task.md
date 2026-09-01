# J03 — 複数段階の Agent Task

主な競合: **VoiceOS**（Notch 上の Agent Mode）

## 課題

「週次ブリーフィングを作って」と頼み、Calendar → Mail → Notion → まとめ、
の各段が進むのを見届ける。

## 完遂の定義

成果物が出て、**各段で何を見たか**が利用者に分かること。

## 測る

| 指標 | 目標 |
| --- | --- |
| task success | 成果物が出たか |
| completion time | 依頼から成果物まで |
| 進行の可読性 | いま何をしているか分かるか（SEQ） |
| window count | 0 |
| 中止できるか | 走っている仕事を止められるか |
| state transition latency | 段が進むまでの間 |

## 注意

**内部の思考は出さない。** Plan / Running / Done / Error だけ。
「考えています」を延々流すのは進行の可視化ではない。
