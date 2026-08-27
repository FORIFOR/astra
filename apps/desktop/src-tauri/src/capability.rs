//! 端末側でできることの申告。正本 §25、UI/UX §22。
//!
//! サーバ側の capability report（`@astra/service-capabilities`）は
//! 「代役のまま本番を動かさない」ための門で、**残っていれば起動を拒む。**
//!
//! こちらは**拒まない。**マイクの無い機械でも Astra は使える（文字で頼める）。
//! 拒む代わりに、できないことを名指しで言う。
//! 同じ形の JSON で返すので、画面と試験は 1 つの読み方で済む。

use serde::{Deserialize, Serialize};

use crate::audio::capture::MicrophoneCapture;
use crate::stt::library::SherpaLibrary;
use crate::stt::model::{self, ModelHealth};

/// 端末の能力。**増やしたら、答える所も増やす。**
pub const DEVICE_CAPABILITIES: &[&str] = &[
    "audio.microphone",
    "audio.system",
    "stt.local",
    "stt.local.japanese",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCapability {
    pub capability: String,
    pub available: bool,
    /// 使えないときの理由。**available=false なら必ず入る。**
    pub reason: Option<String>,
    /// 使えているものの名前。診断と、版を比べるときに要る。
    pub implementation: Option<String>,
}

impl DeviceCapability {
    fn available(capability: &str, implementation: impl Into<String>) -> Self {
        Self {
            capability: capability.to_string(),
            available: true,
            reason: None,
            implementation: Some(implementation.into()),
        }
    }

    fn unavailable(capability: &str, reason: impl Into<String>) -> Self {
        Self {
            capability: capability.to_string(),
            available: false,
            reason: Some(reason.into()),
            implementation: None,
        }
    }
}

fn microphone() -> DeviceCapability {
    match MicrophoneCapture::devices() {
        Ok(devices) if devices.is_empty() => {
            DeviceCapability::unavailable("audio.microphone", "no_input_device")
        }
        Ok(devices) => {
            let name = devices
                .iter()
                .find(|d| d.is_default)
                .or_else(|| devices.first())
                .map(|d| d.name.clone())
                .unwrap_or_else(|| "default".to_string());
            DeviceCapability::available("audio.microphone", name)
        }
        Err(error) => {
            DeviceCapability::unavailable("audio.microphone", format!("{:?}", error.reason))
        }
    }
}

/// システム音声。**まだ実装していない。**
///
/// macOS は ScreenCaptureKit と画面収録の許可が要る。
/// 口だけ作って「取れる」と言わない（会議で相手の声が入らないことに、
/// 録音が終わってから気付くのがいちばん悪い）。
fn system_audio() -> DeviceCapability {
    DeviceCapability::unavailable("audio.system", "not_implemented")
}

fn local_stt() -> DeviceCapability {
    match SherpaLibrary::open() {
        Ok(_) => DeviceCapability::available("stt.local", "sherpa-onnx"),
        Err(problem) => {
            let reason = match problem {
                crate::stt::library::LibraryProblem::Incompatible { .. } => "library_incompatible",
                crate::stt::library::LibraryProblem::NotInstalled { .. } => "library_not_installed",
                crate::stt::library::LibraryProblem::NotLoadable { .. } => "library_not_loadable",
                crate::stt::library::LibraryProblem::MissingSymbol { .. } => {
                    "library_version_mismatch"
                }
            };
            DeviceCapability::unavailable("stt.local", reason)
        }
    }
}

fn japanese_stt() -> DeviceCapability {
    let status = model::japanese_model_status();
    match status.health {
        ModelHealth::Ready => {
            DeviceCapability::available("stt.local.japanese", model::JAPANESE_MODEL_DIR)
        }
        ModelHealth::NotInstalled => {
            DeviceCapability::unavailable("stt.local.japanese", "model_not_installed")
        }
        // 壊れているのと、入れていないのを混ぜない。直し方が違う。
        ModelHealth::Broken => DeviceCapability::unavailable("stt.local.japanese", "model_corrupt"),
    }
}

/// いま端末でできること。**答えない能力を作らない。**
pub fn device_capabilities() -> Vec<DeviceCapability> {
    vec![microphone(), system_audio(), local_stt(), japanese_stt()]
}

#[tauri::command]
pub fn capability_report() -> Vec<DeviceCapability> {
    device_capabilities()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_for_every_capability_it_names() {
        let report = device_capabilities();
        for name in DEVICE_CAPABILITIES {
            assert!(
                report.iter().any(|c| c.capability == *name),
                "{name} is named but never answered"
            );
        }
        assert_eq!(report.len(), DEVICE_CAPABILITIES.len());
    }

    #[test]
    fn always_gives_a_reason_when_something_is_unavailable() {
        for capability in device_capabilities() {
            if !capability.available {
                // 「使えない」だけでは、何をすればよいか分からない
                assert!(
                    capability.reason.is_some(),
                    "{} is unavailable without a reason",
                    capability.capability
                );
            }
        }
    }

    #[test]
    fn does_not_claim_system_audio_it_has_not_built() {
        let system = device_capabilities()
            .into_iter()
            .find(|c| c.capability == "audio.system")
            .expect("audio.system");
        // 会議で相手の声が入らないことに、録音が終わってから気付くのが最悪
        assert!(!system.available);
        assert_eq!(system.reason.as_deref(), Some("not_implemented"));
    }

    #[test]
    fn separates_a_missing_model_from_a_broken_one() {
        // 直し方が違う（入れる / 入れ直す）
        std::env::set_var("ASTRA_STT_MODEL_DIR", "/nonexistent-astra-models");
        let missing = japanese_stt();
        std::env::remove_var("ASTRA_STT_MODEL_DIR");
        assert_eq!(missing.reason.as_deref(), Some("model_not_installed"));
    }
}
