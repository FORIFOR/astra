//! 安定 C ABI。Windows(C#/P-Invoke) が uniffi の C# 非対応を避けて同じ core を使うための境界。
//!
//! UniFFI（Swift 用）と併存する。文字列は呼び出し側が `astra_core_string_free` で解放する。
//! セッションは不透明ハンドル（`astra_core_session_*`）。録音の実体は共通の `Journal`。

use std::ffi::{c_char, CStr, CString};
use std::path::PathBuf;

use crate::recording::{format_elapsed, resample_linear, wire_bytes, Journal, JournalState, WIRE_SAMPLE_RATE};

fn cstr(value: &str) -> *mut c_char {
    CString::new(value).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

unsafe fn rstr<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        return None;
    }
    CStr::from_ptr(p).to_str().ok()
}

/// 版。疎通確認に使う。戻り値は astra_core_string_free で解放。
#[no_mangle]
pub extern "C" fn astra_core_version() -> *mut c_char {
    cstr(env!("CARGO_PKG_VERSION"))
}

/// 00:00 / 1:02:03。戻り値は解放が必要。
#[no_mangle]
pub extern "C" fn astra_core_format_elapsed(ms: u64) -> *mut c_char {
    cstr(&format_elapsed(ms))
}

/// C 文字列を解放する。
///
/// # Safety
/// `astra_core_*` が返したポインタだけを一度だけ渡すこと。
#[no_mangle]
pub unsafe extern "C" fn astra_core_string_free(p: *mut c_char) {
    if !p.is_null() {
        drop(CString::from_raw(p));
    }
}

/// 録音セッション（不透明）。
pub struct CApiSession {
    journal: Journal,
}

/// セッション開始。失敗時 null。
///
/// # Safety
/// `root` / `meeting_id` は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_session_start(
    root: *const c_char,
    meeting_id: *const c_char,
) -> *mut CApiSession {
    let (Some(root), Some(id)) = (rstr(root), rstr(meeting_id)) else {
        return std::ptr::null_mut();
    };
    match Journal::create(&PathBuf::from(root), id, WIRE_SAMPLE_RATE) {
        Ok(journal) => Box::into_raw(Box::new(CApiSession { journal })),
        Err(_) => std::ptr::null_mut(),
    }
}

/// f32 mono サンプルを渡す。閉じた断片数を返す。
///
/// # Safety
/// `session` は start が返した生存ハンドル。`samples` は `len` 個読める。
#[no_mangle]
pub unsafe extern "C" fn astra_core_session_push(
    session: *mut CApiSession,
    samples: *const f32,
    len: usize,
    sample_rate: u32,
) -> u32 {
    let Some(session) = session.as_mut() else {
        return 0;
    };
    let input = if samples.is_null() || len == 0 {
        &[][..]
    } else {
        std::slice::from_raw_parts(samples, len)
    };
    let resampled = resample_linear(input, sample_rate, WIRE_SAMPLE_RATE);
    let bytes = wire_bytes(&resampled);
    session.journal.append(&bytes).map(|c| c.len() as u32).unwrap_or(0)
}

/// これまでに書けた録音長（ms）。
///
/// # Safety
/// `session` は生存ハンドル。
#[no_mangle]
pub unsafe extern "C" fn astra_core_session_recorded_ms(session: *mut CApiSession) -> u64 {
    session.as_ref().map(|s| s.journal.recorded_ms()).unwrap_or(0)
}

/// 取り込みを終える。0 成功 / -1 失敗。
///
/// # Safety
/// `session` は生存ハンドル。
#[no_mangle]
pub unsafe extern "C" fn astra_core_session_finish(session: *mut CApiSession) -> i32 {
    let Some(session) = session.as_mut() else {
        return -1;
    };
    match session.journal.finish(JournalState::Completed) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

/// セッションを破棄する。
///
/// # Safety
/// `session` は start が返したハンドルを一度だけ。
#[no_mangle]
pub unsafe extern "C" fn astra_core_session_free(session: *mut CApiSession) {
    if !session.is_null() {
        drop(Box::from_raw(session));
    }
}
