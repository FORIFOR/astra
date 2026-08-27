//! 安定 C ABI。Windows(C#/P-Invoke) が uniffi の C# 非対応を避けて同じ core を使うための境界。
//!
//! UniFFI（Swift 用）と併存する。文字列は呼び出し側が `astra_core_string_free` で解放する。
//! セッションは不透明ハンドル（`astra_core_session_*`）。録音の実体は共通の `Journal`。

use std::ffi::{c_char, CStr, CString};
use std::path::PathBuf;

use crate::api::{
    api_artifact_content, api_create_meeting, api_create_task, api_dev_sign_in, api_library,
    api_me, api_plugin_catalog, api_reachable, api_wait_task,
};
use crate::connector::{build_authorize_url, pkce_challenge, OauthProvider, ProviderConfig};
use crate::oauth::parse_callback;
use crate::recording::{format_elapsed, mark_meeting_uploaded, resample_linear, wire_bytes, Journal, JournalState, WIRE_SAMPLE_RATE};

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

/// 会議を「アップロード済み」に印す（二重回復を防ぐ）。1=成功 / 0=失敗。
///
/// # Safety
/// `root` / `meeting_id` は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_mark_meeting_uploaded(
    root: *const c_char,
    meeting_id: *const c_char,
) -> i32 {
    match (rstr(root), rstr(meeting_id)) {
        (Some(root), Some(id)) if mark_meeting_uploaded(root.to_string(), id.to_string()) => 1,
        _ => 0,
    }
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

/// PKCE の code_challenge（RFC 7636 S256）。戻り値は astra_core_string_free で解放。
///
/// # Safety
/// `verifier` は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_pkce_challenge(verifier: *const c_char) -> *mut c_char {
    match rstr(verifier) {
        Some(v) => cstr(&pkce_challenge(v)),
        None => std::ptr::null_mut(),
    }
}

/// authorize URL を組む（RFC 6749 + PKCE）。非 loopback / 空 client_id / 未知 provider は null。
/// `scopes` は空白区切り（"openid email"）。戻り値は解放が必要。
///
/// # Safety
/// すべて有効な NUL 終端 UTF-8（または null）。
#[no_mangle]
pub unsafe extern "C" fn astra_core_authorize_url(
    provider: *const c_char,
    client_id: *const c_char,
    redirect_uri: *const c_char,
    scopes_space_joined: *const c_char,
    state: *const c_char,
    code_challenge: *const c_char,
) -> *mut c_char {
    let (Some(provider), Some(client_id), Some(redirect_uri), Some(state), Some(challenge)) = (
        rstr(provider),
        rstr(client_id),
        rstr(redirect_uri),
        rstr(state),
        rstr(code_challenge),
    ) else {
        return std::ptr::null_mut();
    };
    let Some(provider) = OauthProvider::from_id(provider) else {
        return std::ptr::null_mut();
    };
    let scopes = rstr(scopes_space_joined)
        .unwrap_or("")
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let config = ProviderConfig {
        provider,
        client_id: client_id.to_string(),
        redirect_uri: redirect_uri.to_string(),
        scopes,
    };
    match build_authorize_url(&config, state, challenge) {
        Ok(url) => cstr(&url),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 折り返し URL（`/callback?code=...`）を解析して JSON で返す（Windows C# 用）。
/// 例: {"code":"...","state":"...","error":null,...}。戻り値は astra_core_string_free で解放。
///
/// # Safety
/// `target` は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_parse_callback(target: *const c_char) -> *mut c_char {
    let Some(target) = rstr(target) else { return std::ptr::null_mut() };
    let p = parse_callback(target);
    match serde_json::to_string(&p) {
        Ok(json) => cstr(&json),
        Err(_) => std::ptr::null_mut(),
    }
}

// ---- gateway API（実バックエンド）を C ABI で。Windows(C#) が macOS(Swift) と同じ実経路を使う。----
// 文字列を返すものは JSON（複合型）または生値。失敗は NULL。すべて astra_core_string_free で解放。

/// gateway に届くか。1=届く / 0=届かない。
///
/// # Safety
/// `base_url` は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_reachable(base_url: *const c_char) -> i32 {
    match rstr(base_url) {
        Some(base) if api_reachable(base.to_string()) => 1,
        _ => 0,
    }
}

/// 開発サインイン。成功で Tokens の JSON、失敗で NULL。
///
/// # Safety
/// 引数はすべて有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_dev_sign_in(
    base_url: *const c_char,
    email: *const c_char,
    display_name: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(email), Some(name)) = (rstr(base_url), rstr(email), rstr(display_name))
    else {
        return std::ptr::null_mut();
    };
    match api_dev_sign_in(base.to_string(), email.to_string(), name.to_string()) {
        Ok(tokens) => serde_json::to_string(&tokens).map(|j| cstr(&j)).unwrap_or(std::ptr::null_mut()),
        Err(_) => std::ptr::null_mut(),
    }
}

/// /v1/me。成功で Me の JSON、失敗で NULL。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_me(
    base_url: *const c_char,
    access_token: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(token)) = (rstr(base_url), rstr(access_token)) else {
        return std::ptr::null_mut();
    };
    match api_me(base.to_string(), token.to_string()) {
        Ok(me) => serde_json::to_string(&me).map(|j| cstr(&j)).unwrap_or(std::ptr::null_mut()),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 会議を作る。成功で meeting id 文字列、失敗で NULL。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_create_meeting(
    base_url: *const c_char,
    access_token: *const c_char,
    title: *const c_char,
    language: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(token), Some(title), Some(lang)) =
        (rstr(base_url), rstr(access_token), rstr(title), rstr(language))
    else {
        return std::ptr::null_mut();
    };
    match api_create_meeting(base.to_string(), token.to_string(), title.to_string(), lang.to_string()) {
        Ok(id) => cstr(&id),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Agent タスクを作る。成功で task id、失敗で NULL。`input_json` はそのまま送る。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_create_task(
    base_url: *const c_char,
    access_token: *const c_char,
    kind: *const c_char,
    input_json: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(token), Some(kind), Some(input)) =
        (rstr(base_url), rstr(access_token), rstr(kind), rstr(input_json))
    else {
        return std::ptr::null_mut();
    };
    match api_create_task(base.to_string(), token.to_string(), kind.to_string(), input.to_string()) {
        Ok(id) => cstr(&id),
        Err(_) => std::ptr::null_mut(),
    }
}

/// タスクの完了を待つ。成功で TaskStatus の JSON、失敗で NULL。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_wait_task(
    base_url: *const c_char,
    access_token: *const c_char,
    task_id: *const c_char,
    timeout_ms: u64,
) -> *mut c_char {
    let (Some(base), Some(token), Some(id)) = (rstr(base_url), rstr(access_token), rstr(task_id))
    else {
        return std::ptr::null_mut();
    };
    match api_wait_task(base.to_string(), token.to_string(), id.to_string(), timeout_ms) {
        Ok(status) => serde_json::to_string(&status).map(|j| cstr(&j)).unwrap_or(std::ptr::null_mut()),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 成果物の本文。成功で文字列、失敗で NULL。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_artifact_content(
    base_url: *const c_char,
    access_token: *const c_char,
    artifact_id: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(token), Some(id)) = (rstr(base_url), rstr(access_token), rstr(artifact_id))
    else {
        return std::ptr::null_mut();
    };
    match api_artifact_content(base.to_string(), token.to_string(), id.to_string()) {
        Ok(content) => cstr(&content),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Apps カタログ。成功で JSON 配列文字列、失敗で NULL。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_plugin_catalog(
    base_url: *const c_char,
    access_token: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(token)) = (rstr(base_url), rstr(access_token)) else {
        return std::ptr::null_mut();
    };
    match api_plugin_catalog(base.to_string(), token.to_string()) {
        Ok(list) => serde_json::to_string(&list).map(|j| cstr(&j)).unwrap_or(std::ptr::null_mut()),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Library 一覧。成功で JSON 配列文字列、失敗で NULL。
///
/// # Safety
/// 引数は有効な NUL 終端 UTF-8。
#[no_mangle]
pub unsafe extern "C" fn astra_core_api_library(
    base_url: *const c_char,
    access_token: *const c_char,
) -> *mut c_char {
    let (Some(base), Some(token)) = (rstr(base_url), rstr(access_token)) else {
        return std::ptr::null_mut();
    };
    match api_library(base.to_string(), token.to_string()) {
        Ok(list) => serde_json::to_string(&list).map(|j| cstr(&j)).unwrap_or(std::ptr::null_mut()),
        Err(_) => std::ptr::null_mut(),
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
