//! 手元の文字起こし。正本 §11.1。
//!
//! DeepNote (`src-tauri/src/stt/`) を donor implementation として、
//! Astra の契約へ作り直したもの。詳細は `docs/deepnote-audio-stt-migration.md`。
//!
//! **音を勝手にクラウドへ出さない。**ここに居るのは手元で動くものだけ。

pub mod ffi;
pub mod library;
pub mod model;
pub mod recognizer;
