//! sherpa-onnx の C API 束縛（offline recognizer と VAD の分だけ）。
//!
//! DeepNote の `src-tauri/src/stt/sherpa_ffi.rs`（1194 行）から、
//! **offline recognizer と VAD に要る分だけ**を写したもの。
//! 構造体の並びは ABI そのものなので、意訳せずそのまま持ってくる。
//! 並びが 1 つずれると、実行時に落ちるのではなく**静かに壊れる**。
//!
//! 持ち込まなかったもの: online（streaming）、translation、LID。
//! 使わない構造体を並べておくと、更新のたびに全部を追うことになる。
//!
//! sherpa-onnx **v1.13.6** の c-api.h に対応。
//!
//! 版は `library.rs` の `SHERPA_VERSION` と、`scripts/install-local-stt.sh` と
//! 三つで揃える。**ずれると SIGBUS で落ちる**（実際に落ちた）:
//! `SherpaOnnxOfflineModelConfig` は版ごとに末尾へ field が増え、
//! こちらの struct が短いと C 側が `decoding_method` を別の場所から読む。

#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::os::raw::c_char;

#[repr(C)]
pub struct SherpaOnnxFeatureConfig {
    pub sample_rate: i32,
    pub feature_dim: i32,
}

// ─── Homophone replacer config ───

#[repr(C)]
pub struct SherpaOnnxHomophoneReplacerConfig {
    pub dict_dir: *const c_char,
    pub lexicon: *const c_char,
    pub rule_fsts: *const c_char,
}

// ─── Offline model sub-configs ───

#[repr(C)]
pub struct SherpaOnnxOfflineTransducerModelConfig {
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub joiner: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineParaformerModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineNemoEncDecCtcModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineWhisperModelConfig {
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub language: *const c_char,
    pub task: *const c_char,
    pub tail_paddings: i32,
    pub enable_token_timestamps: i32,
    pub enable_segment_timestamps: i32,
}

#[repr(C)]
pub struct SherpaOnnxOfflineCanaryModelConfig {
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub src_lang: *const c_char,
    pub tgt_lang: *const c_char,
    pub use_pnc: i32,
}

#[repr(C)]
pub struct SherpaOnnxOfflineFireRedAsrModelConfig {
    pub encoder: *const c_char,
    pub decoder: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineMoonshineModelConfig {
    pub preprocessor: *const c_char,
    pub encoder: *const c_char,
    pub uncached_decoder: *const c_char,
    pub cached_decoder: *const c_char,
    /// v1.13 で増えた。無いと、これ以降の field が全部ずれる。
    pub merged_decoder: *const c_char,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SherpaOnnxOfflineFireRedAsrCtcModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SherpaOnnxOfflineQwen3ASRModelConfig {
    pub conv_frontend: *const c_char,
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub tokenizer: *const c_char,
    pub max_total_len: i32,
    pub max_new_tokens: i32,
    pub temperature: f32,
    pub top_p: f32,
    pub seed: i32,
    pub hotwords: *const c_char,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SherpaOnnxOfflineCohereTranscribeModelConfig {
    pub encoder: *const c_char,
    pub decoder: *const c_char,
    pub language: *const c_char,
    pub use_punct: i32,
    pub use_itn: i32,
}

#[repr(C)]
pub struct SherpaOnnxOfflineTdnnModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineLMConfig {
    pub model: *const c_char,
    pub scale: f32,
}

#[repr(C)]
pub struct SherpaOnnxOfflineSenseVoiceModelConfig {
    pub model: *const c_char,
    pub language: *const c_char,
    pub use_itn: i32,
}

#[repr(C)]
pub struct SherpaOnnxOfflineDolphinModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineZipformerCtcModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineWenetCtcModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineOmnilingualAsrCtcModelConfig {
    pub model: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineFunASRNanoModelConfig {
    pub encoder_adaptor: *const c_char,
    pub llm: *const c_char,
    pub embedding: *const c_char,
    pub tokenizer: *const c_char,
    pub system_prompt: *const c_char,
    pub user_prompt: *const c_char,
    pub max_new_tokens: i32,
    pub temperature: f32,
    pub top_p: f32,
    pub seed: i32,
    pub language: *const c_char,
    pub itn: i32,
    pub hotwords: *const c_char,
}

#[repr(C)]
pub struct SherpaOnnxOfflineMedAsrCtcModelConfig {
    pub model: *const c_char,
}

// ─── Offline model config (aggregated) ───

#[repr(C)]
pub struct SherpaOnnxOfflineModelConfig {
    pub transducer: SherpaOnnxOfflineTransducerModelConfig,
    pub paraformer: SherpaOnnxOfflineParaformerModelConfig,
    pub nemo_ctc: SherpaOnnxOfflineNemoEncDecCtcModelConfig,
    pub whisper: SherpaOnnxOfflineWhisperModelConfig,
    pub tdnn: SherpaOnnxOfflineTdnnModelConfig,
    pub tokens: *const c_char,
    pub num_threads: i32,
    pub debug: i32,
    pub provider: *const c_char,
    pub model_type: *const c_char,
    pub modeling_unit: *const c_char,
    pub bpe_vocab: *const c_char,
    pub telespeech_ctc: *const c_char,
    pub sense_voice: SherpaOnnxOfflineSenseVoiceModelConfig,
    pub moonshine: SherpaOnnxOfflineMoonshineModelConfig,
    pub fire_red_asr: SherpaOnnxOfflineFireRedAsrModelConfig,
    pub dolphin: SherpaOnnxOfflineDolphinModelConfig,
    pub zipformer_ctc: SherpaOnnxOfflineZipformerCtcModelConfig,
    pub canary: SherpaOnnxOfflineCanaryModelConfig,
    pub wenet_ctc: SherpaOnnxOfflineWenetCtcModelConfig,
    pub omnilingual: SherpaOnnxOfflineOmnilingualAsrCtcModelConfig,
    pub medasr: SherpaOnnxOfflineMedAsrCtcModelConfig,
    pub funasr_nano: SherpaOnnxOfflineFunASRNanoModelConfig,
    // v1.13.6 で増えた 3 つ。**末尾に足す。**順序は c-api.h のまま。
    pub fire_red_asr_ctc: SherpaOnnxOfflineFireRedAsrCtcModelConfig,
    pub qwen3_asr: SherpaOnnxOfflineQwen3ASRModelConfig,
    pub cohere_transcribe: SherpaOnnxOfflineCohereTranscribeModelConfig,
}

// ─── Offline recognizer config ───

#[repr(C)]
pub struct SherpaOnnxOfflineRecognizerConfig {
    pub feat_config: SherpaOnnxFeatureConfig,
    pub model_config: SherpaOnnxOfflineModelConfig,
    pub lm_config: SherpaOnnxOfflineLMConfig,
    pub decoding_method: *const c_char,
    pub max_active_paths: i32,
    pub hotwords_file: *const c_char,
    pub hotwords_score: f32,
    pub rule_fsts: *const c_char,
    pub rule_fars: *const c_char,
    pub blank_penalty: f32,
    pub hr: SherpaOnnxHomophoneReplacerConfig,
}

// ─── Opaque types ───

pub enum SherpaOnnxOfflineRecognizer {}
pub enum SherpaOnnxOfflineStream {}

// ─── VAD (Voice Activity Detection) structs ───

#[repr(C)]
pub struct SherpaOnnxSileroVadModelConfig {
    pub model: *const c_char,
    pub threshold: f32,
    pub min_silence_duration: f32,
    pub min_speech_duration: f32,
    pub window_size: i32,
    pub max_speech_duration: f32,
}

#[repr(C)]
pub struct SherpaOnnxTenVadModelConfig {
    pub model: *const c_char,
    pub threshold: f32,
    pub min_silence_duration: f32,
    pub min_speech_duration: f32,
    pub max_speech_duration: f32,
}

#[repr(C)]
pub struct SherpaOnnxVadModelConfig {
    pub silero_vad: SherpaOnnxSileroVadModelConfig,
    pub sample_rate: i32,
    pub num_threads: i32,
    pub provider: *const c_char,
    pub debug: i32,
    pub ten_vad: SherpaOnnxTenVadModelConfig,
}

#[repr(C)]
pub struct SherpaOnnxSpeechSegment {
    pub start: i32,
    pub samples: *const f32,
    pub n: i32,
}

pub enum SherpaOnnxVoiceActivityDetector {}

// ─── 実行時に解決する関数の型 ───
//
// **build 時にリンクしない。**リンクすると、dylib が無い環境で
// アプリそのものが起動しなくなる。無いなら「無い」と言えるほうがよい。

pub type CreateOfflineRecognizerFn = unsafe extern "C" fn(
    *const SherpaOnnxOfflineRecognizerConfig,
) -> *const SherpaOnnxOfflineRecognizer;
pub type DestroyOfflineRecognizerFn = unsafe extern "C" fn(*const SherpaOnnxOfflineRecognizer);
pub type CreateOfflineStreamFn =
    unsafe extern "C" fn(*const SherpaOnnxOfflineRecognizer) -> *const SherpaOnnxOfflineStream;
pub type DestroyOfflineStreamFn = unsafe extern "C" fn(*const SherpaOnnxOfflineStream);
pub type AcceptWaveformOfflineFn =
    unsafe extern "C" fn(*const SherpaOnnxOfflineStream, i32, *const f32, i32);
pub type DecodeOfflineStreamFn =
    unsafe extern "C" fn(*const SherpaOnnxOfflineRecognizer, *const SherpaOnnxOfflineStream);
pub type GetOfflineStreamResultFn =
    unsafe extern "C" fn(
        *const SherpaOnnxOfflineStream,
    ) -> *const SherpaOnnxOfflineRecognizerResult;
pub type DestroyOfflineResultFn = unsafe extern "C" fn(*const SherpaOnnxOfflineRecognizerResult);

/// 認識結果。**並びは c-api.h のまま。**読むのは `text` だけだが、
/// 途中を省くと以降の項目がずれて、別のポインタを文字列として読むことになる。
#[repr(C)]
pub struct SherpaOnnxOfflineRecognizerResult {
    pub text: *const c_char,
    pub timestamps: *mut f32,
    pub count: i32,
    pub tokens: *const c_char,
    pub tokens_arr: *const *const c_char,
    pub json: *const c_char,
    pub lang: *const c_char,
    pub emotion: *const c_char,
    pub event: *const c_char,
    pub durations: *mut f32,
    pub ys_log_probs: *mut f32,
    pub segment_timestamps: *const f32,
    pub segment_durations: *const f32,
    pub segment_texts: *const c_char,
    pub segment_texts_arr: *const *const c_char,
    pub segment_count: i32,
}

/// `SherpaOnnxGetVersionStr`。読み込んだ dylib が何の版かを聞く。
pub type GetVersionStrFn = unsafe extern "C" fn() -> *const c_char;
