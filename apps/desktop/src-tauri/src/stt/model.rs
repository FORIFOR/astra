//! 認識モデルの所在と健康。正本 §11.1。
//!
//! DeepNote の `commands/model_commands.rs` から、**manifest + 検証 + 隔離**の
//! 考え方だけを引き継ぐ。ダウンロード UI と DeepNote の置き場所は持ち込まない。
//!
//! **無いモデルで起動を止めない。**止めるのではなく、
//! 「無い」と capability report で言い、文字起こしだけが使えない状態にする。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 日本語モデル。DeepNote が実績を積んでいるもの。
pub const JAPANESE_MODEL_DIR: &str = "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01";

/// これが揃っていないと recognizer を作れない。
pub const REQUIRED_FILES: &[&str] = &[
    "encoder-epoch-99-avg-1.int8.onnx",
    "decoder-epoch-99-avg-1.int8.onnx",
    "joiner-epoch-99-avg-1.int8.onnx",
    "tokens.txt",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelHealth {
    Ready,
    /// 1 つも無い。まだ入れていない。
    NotInstalled,
    /// 一部が無い、または大きさが 0。入れかけで止まっている。
    Broken,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub health: ModelHealth,
    pub directory: String,
    /// 存在しないファイル。
    pub missing: Vec<String>,
    /// あるが大きさが 0 のファイル。**「ある」と数えない。**
    pub empty: Vec<String>,
}

impl ModelStatus {
    pub fn is_ready(&self) -> bool {
        self.health == ModelHealth::Ready
    }
}

/// 置き場所。**DeepNote の場所を見に行かない。**
///
/// 別アプリの領域を読むと、片方を消したときにもう片方が壊れる。
pub fn models_root() -> PathBuf {
    if let Ok(explicit) = std::env::var("ASTRA_STT_MODEL_DIR") {
        if !explicit.trim().is_empty() {
            return PathBuf::from(explicit);
        }
    }
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Astra")
        .join("models")
}

pub fn japanese_model_dir() -> PathBuf {
    models_root().join(JAPANESE_MODEL_DIR)
}

/// 見に行く。**壊れているものを「ある」と言わない。**
pub fn inspect(directory: &Path) -> ModelStatus {
    let mut missing = Vec::new();
    let mut empty = Vec::new();

    for name in REQUIRED_FILES {
        let path = directory.join(name);
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() == 0 => empty.push((*name).to_string()),
            Ok(_) => {}
            Err(_) => missing.push((*name).to_string()),
        }
    }

    let health = if missing.len() == REQUIRED_FILES.len() {
        // 1 つも無い = まだ入れていない。壊れているのとは違う。
        ModelHealth::NotInstalled
    } else if missing.is_empty() && empty.is_empty() {
        ModelHealth::Ready
    } else {
        ModelHealth::Broken
    };

    ModelStatus {
        health,
        directory: directory.display().to_string(),
        missing,
        empty,
    }
}

pub fn japanese_model_status() -> ModelStatus {
    inspect(&japanese_model_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("astra-model-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create");
        dir
    }

    #[test]
    fn an_empty_directory_is_not_installed() {
        let dir = temp_dir("empty");
        let status = inspect(&dir);
        // 「まだ入れていない」と「壊れている」を混ぜない
        assert_eq!(status.health, ModelHealth::NotInstalled);
        assert_eq!(status.missing.len(), REQUIRED_FILES.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_half_installed_directory_is_broken() {
        let dir = temp_dir("half");
        std::fs::write(dir.join(REQUIRED_FILES[0]), b"x").expect("write");
        let status = inspect(&dir);
        assert_eq!(status.health, ModelHealth::Broken);
        assert!(!status.missing.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_zero_length_file_does_not_count_as_present() {
        let dir = temp_dir("zero");
        for name in REQUIRED_FILES {
            std::fs::write(dir.join(name), b"").expect("write");
        }
        let status = inspect(&dir);
        assert_eq!(status.health, ModelHealth::Broken);
        assert_eq!(status.empty.len(), REQUIRED_FILES.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_complete_directory_is_ready() {
        let dir = temp_dir("ready");
        for name in REQUIRED_FILES {
            std::fs::write(dir.join(name), b"x").expect("write");
        }
        assert!(inspect(&dir).is_ready());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn does_not_look_inside_another_application() {
        std::env::remove_var("ASTRA_STT_MODEL_DIR");
        let root = models_root().display().to_string();
        // 別アプリの領域を読むと、片方を消したときにもう片方が壊れる
        assert!(!root.contains("DeepNote"));
        assert!(root.contains("Astra"));
    }
}
