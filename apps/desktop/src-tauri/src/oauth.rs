//! 認可の折り返しを待ち受ける。RFC 8252（native app）。
//!
//! **loopback でだけ待つ。**カスタム URL scheme は、
//! 同じ端末の別のアプリが横取りできる。ephemeral port の
//! loopback listener が、native app の正しいやり方（§7.3）。
//!
//! ここが持つのは待ち受けだけ。トークンの交換も保管も TypeScript 側
//! （`@astra/oauth`）にあり、**このプロセスは code と state を右から左へ渡すだけ。**
//! 交換をここへ持ち込むと、資格情報の通り道が二重になる。

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// 折り返しを待つ上限。TypeScript 側の AUTHORIZATION_TIMEOUT_MS と揃える。
const WAIT_TIMEOUT: Duration = Duration::from_secs(300);

/// 1 回の待ち受け。**使い捨て。**
#[derive(Default)]
pub struct OauthRuntime {
    listener: Mutex<Option<TcpListener>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listening {
    /// 実際に開いた折り返し先。**ここを authorize URL に使う。**
    pub redirect_uri: String,
    pub port: u16,
}

// 折り返しで戻る値の型は astra-core が正本（macOS/Windows native も同じ型を使う）。
pub use astra_core::CallbackParams;

/// 待ち受けを開く。**port は OS に選ばせる。**
///
/// 固定 port を使うと、既に埋まっているときに黙って失敗するか、
/// 別のアプリの待ち受けへ折り返すことになる。
#[tauri::command]
pub fn oauth_listen(runtime: tauri::State<'_, OauthRuntime>) -> Result<Listening, String> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| format!("could not open a loopback listener ({error})"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("could not read the listener address ({error})"))?
        .port();

    let mut slot = runtime
        .listener
        .lock()
        .map_err(|_| "the listener is in a bad state".to_string())?;
    // 前の待ち受けは閉じる。開きっぱなしを残さない。
    *slot = Some(listener);

    Ok(Listening {
        redirect_uri: format!("http://127.0.0.1:{port}/callback"),
        port,
    })
}

/// 折り返しを 1 回だけ受け取る。**受け取ったら閉じる。**
#[tauri::command]
pub fn oauth_await_callback(
    runtime: tauri::State<'_, OauthRuntime>,
) -> Result<CallbackParams, String> {
    let listener = {
        let mut slot = runtime
            .listener
            .lock()
            .map_err(|_| "the listener is in a bad state".to_string())?;
        slot.take()
            .ok_or_else(|| "no sign-in is waiting".to_string())?
    };

    listener
        .set_nonblocking(false)
        .map_err(|error| format!("could not wait on the listener ({error})"))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|error| format!("the sign-in did not come back ({error})"))?;
    stream
        .set_read_timeout(Some(WAIT_TIMEOUT))
        .map_err(|error| format!("could not set a deadline ({error})"))?;

    let target = read_request_target(&mut stream)?;
    let params = parse_callback(&target);
    // 相手のブラウザには、閉じてよいとだけ伝える
    respond(&mut stream, &params);
    Ok(params)
}

/// 待ち受けをやめる。中断したときに開きっぱなしにしない。
#[tauri::command]
pub fn oauth_cancel(runtime: tauri::State<'_, OauthRuntime>) -> Result<(), String> {
    let mut slot = runtime
        .listener
        .lock()
        .map_err(|_| "the listener is in a bad state".to_string())?;
    *slot = None;
    Ok(())
}

fn read_request_target(stream: &mut TcpStream) -> Result<String, String> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| format!("could not read the callback ({error})"))?;
    // "GET /callback?code=... HTTP/1.1"
    line.split_whitespace()
        .nth(1)
        .map(str::to_string)
        .ok_or_else(|| "the callback was not a request we understand".to_string())
}

// クエリの読み取り・percent decode は astra-core が正本。ここは待ち受けだけ持つ。
pub use astra_core::parse_callback;

fn respond(stream: &mut TcpStream, params: &CallbackParams) {
    let message = if params.error.is_some() {
        "サインインは完了しませんでした。Astra に戻ってください。"
    } else {
        "サインインが終わりました。このタブは閉じて構いません。"
    };
    let body =
        format!("<!doctype html><meta charset=\"utf-8\"><title>Astra</title><p>{message}</p>");
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    // クエリ解析・percent decode・URL 許可判定のテストは astra-core 側に移動。
    // ここに残すのは待ち受け（OS 統合）のテストだけ。
    #[test]
    fn opens_on_a_port_the_os_chose() {
        let runtime = OauthRuntime::default();
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
        let port = listener.local_addr().unwrap().port();
        *runtime.listener.lock().unwrap() = Some(listener);
        // 固定 port を使わない。埋まっているときに黙って失敗する。
        assert!(port > 0);
    }
}

/// 外のブラウザで開く。**アプリ内の webview では開かない**（RFC 8252 §8.12）。
///
/// https と、gateway の開発用 http://localhost / 127.0.0.1 だけ。
/// それ以外（file:, javascript:, 任意の scheme）は開かない。URL は画面側から来るので、
/// ここで絞らないと「開く」が何でも実行する口になる。
#[tauri::command]
pub fn oauth_open_browser(url: String) -> Result<(), String> {
    if !astra_core::is_allowed_auth_url(&url) {
        return Err(format!("refusing to open a non-https url: {}", url.chars().take(32).collect::<String>()));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("opening a browser is only wired on macOS".to_string())
    }
}
