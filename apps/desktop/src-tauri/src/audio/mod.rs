//! 音声の取り込み。正本 §11・§12。
//!
//! DeepNote (`src-tauri/src/audio/`) を donor implementation として、
//! Astra の契約（出所を落とさない・型付きの失敗・計測できる）へ作り直したもの。
//! 詳細は `docs/deepnote-audio-stt-migration.md`。

pub mod capture;
pub mod frame;
pub mod resample;
