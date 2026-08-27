//! サインイン折り返しの純ドメイン。OS も Tauri も知らない。
//!
//! **待ち受け（TcpListener）とブラウザ起動は各アプリ側に残す**（OS 統合）。ここが持つのは、
//! 折り返し URL のクエリを読む・percent decode する・開いてよい認可 URL かを判定する、という
//! OS 非依存のロジックだけ。macOS も Windows も、自前の loopback listener からこの同じ関数を使う。
//! 正本: RFC 8252（native app の認可）。connector/サインインの契約処理をここに集約する。

use serde::{Deserialize, Serialize};

/// 折り返しで戻る値。提供者が足す余計なものは持ち込まない。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    /// サインインの relay（LINE / Apple web）は code ではなく ID トークンを返す。
    pub id_token: Option<String>,
    /// Apple は初回だけ名前を返す。relay がここに載せる。
    pub display_name: Option<String>,
}

/// 折り返しの request target（例 `/callback?code=...&state=...`）を読む。
/// **分からないキーは持ち込まない。**
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
            "id_token" => params.id_token = Some(decoded),
            "display_name" => params.display_name = Some(decoded),
            "error_description" => params.error_description = Some(decoded),
            // 提供者が足す余計なものは無視する
            _ => {}
        }
    }
    params
}

/// application/x-www-form-urlencoded の decode。`+` は空白、`%2B` は `+`。
pub fn percent_decode(value: &str) -> String {
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

/// 外のブラウザで開いてよい認可 URL か。https と、gateway 開発用の
/// http://localhost / 127.0.0.1 だけ。それ以外（file:, javascript:, 任意 scheme）は拒否。
/// **URL は画面側から来るので、ここで絞らないと「開く」が何でも実行する口になる**（RFC 8252 §8.12）。
pub fn is_allowed_auth_url(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1")
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
        let params = parse_callback("/callback?error_description=too+long");
        assert_eq!(params.error_description.as_deref(), Some("too long"));
    }

    #[test]
    fn opens_only_https_and_loopback() {
        assert!(is_allowed_auth_url("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
        assert!(is_allowed_auth_url("http://127.0.0.1:8123/x"));
        assert!(is_allowed_auth_url("http://localhost:8123/x"));
        assert!(!is_allowed_auth_url("file:///etc/passwd"));
        assert!(!is_allowed_auth_url("javascript:alert(1)"));
        assert!(!is_allowed_auth_url("http://evil.example.com/x"));
    }
}
