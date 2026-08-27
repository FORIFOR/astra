//! sherpa-onnx を**実行時に**読む。正本 §11.1・§21。
//!
//! build 時にリンクしない理由:
//!
//!   - リンクすると、dylib が無い環境で**アプリそのものが起動しない**。
//!     文字起こしが使えないのと、アプリが立ち上がらないのは別の話
//!   - 150MB の dylib をリポジトリへ入れずに済む
//!   - 「無い」を capability report で言える（§25）
//!
//! DeepNote は macOS で build 時リンク、Windows で `libloading` と分けていた。
//! Astra はどちらも実行時に統一する。分けると、片方でしか起きない失敗ができる。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use libloading::{Library, Symbol};

use super::ffi;

/// 読めない理由。**「使えない」で一括りにしない。**
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LibraryProblem {
    /// 読めたが、struct の並びが合わない版。読み進めると落ちる。
    Incompatible { found: String, expected: String },
    /// 置き場所に無い。まだ入れていない。
    NotInstalled { looked_in: Vec<String> },
    /// あるが開けない。壊れているか、別の CPU 向け。
    NotLoadable { path: String, reason: String },
    /// 開けたが、要る関数が無い。版が違う。
    MissingSymbol { symbol: String },
}

impl std::fmt::Display for LibraryProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Incompatible { found, expected } => {
                write!(
                    f,
                    "sherpa-onnx {found} is installed, but this build was written for {expected}; run scripts/install-local-stt.sh to get the matching library"
                )
            }
            Self::NotInstalled { looked_in } => {
                write!(
                    f,
                    "sherpa-onnx is not installed (looked in {})",
                    looked_in.join(", ")
                )
            }
            Self::NotLoadable { path, reason } => {
                write!(f, "sherpa-onnx at {path} could not be loaded: {reason}")
            }
            Self::MissingSymbol { symbol } => {
                write!(
                    f,
                    "sherpa-onnx is missing {symbol}; the version does not match"
                )
            }
        }
    }
}

fn library_file_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libsherpa-onnx-c-api.dylib"
    } else if cfg!(target_os = "windows") {
        "sherpa-onnx-c-api.dll"
    } else {
        "libsherpa-onnx-c-api.so"
    }
}

/// 探す場所。**上から順に。**環境変数を最優先にするのは、
/// 開発中に別の版を差し替えられるようにするため。
/// struct の並びを合わせてある版。`ffi.rs` と `scripts/install-local-stt.sh` と揃える。
///
/// **違う版を黙って読まない。**`SherpaOnnxOfflineModelConfig` は版ごとに
/// 末尾へ field が増える。短い struct を渡すと C 側が別の場所から読み、
/// SIGBUS で**プロセスごと落ちる**。落ちる前に、版で断る。
pub const SHERPA_VERSION: &str = "1.13.6";

/// major.minor が同じなら struct の並びは同じ、と見なす。
pub fn is_compatible(found: &str, expected: &str) -> bool {
    let key = |v: &str| {
        let mut it = v.trim().trim_start_matches('v').split('.');
        (
            it.next().unwrap_or("").to_string(),
            it.next().unwrap_or("").to_string(),
        )
    };
    key(found) == key(expected)
}

pub fn search_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(explicit) = std::env::var("ASTRA_SHERPA_LIB_DIR") {
        if !explicit.trim().is_empty() {
            paths.push(PathBuf::from(explicit).join(library_file_name()));
        }
    }
    if let Some(data) = dirs::data_local_dir() {
        paths.push(data.join("Astra").join("lib").join(library_file_name()));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join(library_file_name()));
            paths.push(dir.join("..").join("Frameworks").join(library_file_name()));
        }
    }
    paths
}

/// 要る関数だけをまとめたもの。**使わない関数は引かない。**
pub struct SherpaLibrary {
    _library: Library,
    pub create_recognizer: ffi::CreateOfflineRecognizerFn,
    pub destroy_recognizer: ffi::DestroyOfflineRecognizerFn,
    pub create_stream: ffi::CreateOfflineStreamFn,
    pub destroy_stream: ffi::DestroyOfflineStreamFn,
    pub accept_waveform: ffi::AcceptWaveformOfflineFn,
    pub decode_stream: ffi::DecodeOfflineStreamFn,
    pub get_result: ffi::GetOfflineStreamResultFn,
    pub destroy_result: ffi::DestroyOfflineResultFn,
}

// dylib の関数はスレッド安全（各 stream が独立）。呼ぶ側で Mutex を掛ける。
unsafe impl Send for SherpaLibrary {}
unsafe impl Sync for SherpaLibrary {}

impl SherpaLibrary {
    /// 探して開く。**見つからないことは失敗ではなく、状態。**
    pub fn open() -> Result<Arc<Self>, LibraryProblem> {
        Self::open_from(&search_paths())
    }

    /// 候補を順に見て、最初に在るものを開く。**見た場所を全部言う。**
    pub fn open_from(candidates: &[PathBuf]) -> Result<Arc<Self>, LibraryProblem> {
        let found = candidates.iter().find(|path| path.exists());

        let Some(path) = found else {
            return Err(LibraryProblem::NotInstalled {
                looked_in: candidates.iter().map(|p| p.display().to_string()).collect(),
            });
        };

        Self::open_at(path)
    }

    pub fn open_at(path: &Path) -> Result<Arc<Self>, LibraryProblem> {
        let library = unsafe { Library::new(path) }.map_err(|e| LibraryProblem::NotLoadable {
            path: path.display().to_string(),
            reason: e.to_string(),
        })?;

        macro_rules! symbol {
            ($name:literal, $ty:ty) => {{
                let symbol: Symbol<$ty> =
                    unsafe { library.get($name) }.map_err(|_| LibraryProblem::MissingSymbol {
                        symbol: String::from_utf8_lossy($name)
                            .trim_end_matches('\0')
                            .to_string(),
                    })?;
                *symbol
            }};
        }

        let create_recognizer = symbol!(
            b"SherpaOnnxCreateOfflineRecognizer\0",
            ffi::CreateOfflineRecognizerFn
        );
        let destroy_recognizer = symbol!(
            b"SherpaOnnxDestroyOfflineRecognizer\0",
            ffi::DestroyOfflineRecognizerFn
        );
        let create_stream = symbol!(
            b"SherpaOnnxCreateOfflineStream\0",
            ffi::CreateOfflineStreamFn
        );
        let destroy_stream = symbol!(
            b"SherpaOnnxDestroyOfflineStream\0",
            ffi::DestroyOfflineStreamFn
        );
        let accept_waveform = symbol!(
            b"SherpaOnnxAcceptWaveformOffline\0",
            ffi::AcceptWaveformOfflineFn
        );
        let decode_stream = symbol!(
            b"SherpaOnnxDecodeOfflineStream\0",
            ffi::DecodeOfflineStreamFn
        );
        let get_result = symbol!(
            b"SherpaOnnxGetOfflineStreamResult\0",
            ffi::GetOfflineStreamResultFn
        );
        let destroy_result = symbol!(
            b"SherpaOnnxDestroyOfflineRecognizerResult\0",
            ffi::DestroyOfflineResultFn
        );

        log::info!("sherpa-onnx loaded from {}", path.display());

        // 版を聞く。古い dylib には無い関数なので、無ければ「分からない」として通さない。
        let version = unsafe { library.get::<ffi::GetVersionStrFn>(b"SherpaOnnxGetVersionStr\0") }
            .ok()
            .map(|f| {
                unsafe { std::ffi::CStr::from_ptr(f()) }
                    .to_string_lossy()
                    .into_owned()
            });
        match version {
            Some(v) if is_compatible(&v, SHERPA_VERSION) => {}
            Some(v) => {
                return Err(LibraryProblem::Incompatible {
                    found: v,
                    expected: SHERPA_VERSION.to_string(),
                })
            }
            None => {
                return Err(LibraryProblem::Incompatible {
                    found: "unknown (no SherpaOnnxGetVersionStr)".to_string(),
                    expected: SHERPA_VERSION.to_string(),
                })
            }
        }

        Ok(Arc::new(Self {
            _library: library,
            create_recognizer,
            destroy_recognizer,
            create_stream,
            destroy_stream,
            accept_waveform,
            decode_stream,
            get_result,
            destroy_result,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_in_more_than_one_place() {
        assert!(!search_paths().is_empty());
    }

    #[test]
    fn honours_an_explicit_directory_first() {
        std::env::set_var("ASTRA_SHERPA_LIB_DIR", "/tmp/astra-sherpa-test");
        let paths = search_paths();
        std::env::remove_var("ASTRA_SHERPA_LIB_DIR");
        assert!(paths[0].starts_with("/tmp/astra-sherpa-test"));
    }

    #[test]
    fn says_where_it_looked_when_nothing_is_there() {
        /*
         * `open()` は端末の Application Support も見に行く。
         * そこに dylib が入っている端末（いまのこの端末）では
         * 「無い」を再現できないので、候補を直接渡して試す。
         */
        let bogus = PathBuf::from("/nonexistent-astra-sherpa").join(library_file_name());
        let problem = SherpaLibrary::open_from(&[bogus]).err();
        match problem {
            Some(LibraryProblem::NotInstalled { looked_in }) => {
                // どこを見たかを言わないと、どこへ置けばよいか分からない
                assert!(looked_in
                    .iter()
                    .any(|p| p.contains("nonexistent-astra-sherpa")));
            }
            other => panic!("expected NotInstalled, got {other:?}"),
        }
    }

    #[test]
    fn refuses_a_file_that_is_not_a_library() {
        let path = std::env::temp_dir().join("astra-not-a-dylib");
        std::fs::write(&path, b"not a library").expect("write");
        let problem = SherpaLibrary::open_at(&path).err();
        let _ = std::fs::remove_file(&path);
        assert!(matches!(problem, Some(LibraryProblem::NotLoadable { .. })));
    }
}

#[cfg(test)]
mod version_tests {
    use super::is_compatible;

    #[test]
    fn same_major_minor_is_fine() {
        assert!(is_compatible("1.13.6", "1.13.6"));
        assert!(is_compatible("v1.13.9", "1.13.6"));
    }

    #[test]
    fn a_different_minor_is_refused_before_it_can_crash() {
        // 1.12 と 1.13 で struct の並びが違い、実際に SIGBUS で落ちた
        assert!(!is_compatible("1.12.25", "1.13.6"));
        assert!(!is_compatible("1.14.0", "1.13.6"));
        assert!(!is_compatible("", "1.13.6"));
    }
}
