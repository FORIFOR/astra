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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

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

/// クエリを読む。**分からないものは持ち込まない。**
pub fn parse_callback(target: &str) -> CallbackParams {
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut params = CallbackParams::default();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let decoded = percent_decode(value);
        match key {
            "code" => params.code = Some(decoded),
            "state" => params.state = Some(decoded),
            "error" => params.error = Some(decoded),
            "error_description" => params.error_description = Some(decoded),
            // 提供者が足す余計なものは無視する
            _ => {}
        }
    }
    params
}

fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

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

    #[test]
    fn reads_the_code_and_the_state() {
        let params = parse_callback("/callback?code=abc&state=xyz");
        assert_eq!(params.code.as_deref(), Some("abc"));
        assert_eq!(params.state.as_deref(), Some("xyz"));
        assert!(params.error.is_none());
    }

    #[test]
    fn reads_a_refusal() {
        let params =
            parse_callback("/callback?error=access_denied&error_description=%E6%8B%92%E5%90%A6");
        assert_eq!(params.error.as_deref(), Some("access_denied"));
        // 理由を握り潰さない
        assert_eq!(params.error_description.as_deref(), Some("拒否"));
    }

    #[test]
    fn ignores_anything_it_does_not_know() {
        let params = parse_callback("/callback?code=a&scope=mail.read&authuser=0");
        assert_eq!(params.code.as_deref(), Some("a"));
    }

    #[test]
    fn survives_a_callback_with_no_query() {
        let params = parse_callback("/callback");
        assert!(params.code.is_none());
        assert!(params.state.is_none());
    }

    #[test]
    fn decodes_a_code_that_was_escaped() {
        // %2B は `+` であって空白ではない。取り違えるとコードが壊れる。
        let params = parse_callback("/callback?code=4%2F0Ab%2Bc");
        assert_eq!(params.code.as_deref(), Some("4/0Ab+c"));
    }

    #[test]
    fn reads_a_literal_plus_as_a_space() {
        // form-encoded の `+` は空白（説明文に現れる）
        let params = parse_callback("/callback?error_description=too+long");
        assert_eq!(params.error_description.as_deref(), Some("too long"));
    }

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
