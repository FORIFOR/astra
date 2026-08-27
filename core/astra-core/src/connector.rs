//! Connector（外部サービス連携）の契約層。OS も Tauri も知らない純ドメイン。
//!
//! **ここに live なトークン交換（token endpoint への POST）は持たない**——それは提供者ごとの
//! ネットワーク処理で、各アプリ側 or gateway に置く。ここが持つのは、どの提供者に繋げるか・
//! authorize URL の組み立て（RFC 6749 §4.1）・PKCE(RFC 7636 S256)・折り返しの受理判定（CSRF state /
//! 期限）という、macOS/Windows native が共有する OS 非依存のロジックだけ。正本 §21・§2.4。
//!
//! TypeScript の `@astra/oauth`（flow.ts / pkce.ts / providers.ts）を Rust の契約へ写したもの。
//! **client_secret は持たない**（native app は秘密を保てない, RFC 8252 §8.5）。

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

/// 対応している提供者。ここに無いものへは繋がない。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OauthProvider {
    Google,
    Microsoft,
}

impl OauthProvider {
    pub fn id(self) -> &'static str {
        match self {
            OauthProvider::Google => "google",
            OauthProvider::Microsoft => "microsoft",
        }
    }

    pub fn all() -> [OauthProvider; 2] {
        [OauthProvider::Google, OauthProvider::Microsoft]
    }

    pub fn from_id(id: &str) -> Option<OauthProvider> {
        match id {
            "google" => Some(OauthProvider::Google),
            "microsoft" => Some(OauthProvider::Microsoft),
            _ => None,
        }
    }

    /// 動かない部分（端点と、refresh token を貰うための追加パラメータ）。
    pub fn authorize_url(self) -> &'static str {
        match self {
            OauthProvider::Google => "https://accounts.google.com/o/oauth2/v2/auth",
            OauthProvider::Microsoft => {
                "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
            }
        }
    }

    pub fn token_url(self) -> &'static str {
        match self {
            OauthProvider::Google => "https://oauth2.googleapis.com/token",
            OauthProvider::Microsoft => {
                "https://login.microsoftonline.com/common/oauth2/v2.0/token"
            }
        }
    }

    /// 提供者ごとの追加 authorize パラメータ（Google の access_type/prompt など）。
    pub fn extra_params(self) -> Vec<(&'static str, &'static str)> {
        match self {
            // refresh token を貰うために要る。無いと 1 時間で黙って切れる。
            OauthProvider::Google => vec![("access_type", "offline"), ("prompt", "consent")],
            OauthProvider::Microsoft => vec![("prompt", "consent")],
        }
    }

    /// client_id を渡す環境変数の名前。1 箇所で決める。
    pub fn client_id_var(self) -> String {
        format!("ASTRA_OAUTH_{}_CLIENT_ID", self.id().to_uppercase())
    }
}

/// 折り返し先が loopback か。RFC 8252 §7.3。**他所へ折り返させない。**
pub fn is_loopback_redirect(uri: &str) -> bool {
    // http://127.0.0.1[...] または http://[::1][...] だけ。
    let rest = match uri.strip_prefix("http://") {
        Some(r) => r,
        None => return false,
    };
    let host = rest
        .split(['/', ':', '?'])
        .next()
        .unwrap_or("");
    host == "127.0.0.1" || rest.starts_with("[::1]")
}

/// PKCE の code_challenge（RFC 7636, **S256 のみ**）。base64url(sha256(verifier))。
/// **plain には落とさない。**verifier は 43..128 文字（呼び出し側が保証）。
pub fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64url(&digest)
}

/// RFC 7636 §4.1 の verifier 長さ。
pub const MIN_VERIFIER_LENGTH: usize = 43;
pub const MAX_VERIFIER_LENGTH: usize = 128;

/// verifier が RFC の長さに収まるか。
pub fn verifier_is_valid(verifier: &str) -> bool {
    let n = verifier.chars().count();
    n >= MIN_VERIFIER_LENGTH && n <= MAX_VERIFIER_LENGTH
}

/// 繋ぐ設定。client_id は実行時に与える（同梱しない）。
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub provider: OauthProvider,
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
}

/// authorize URL を組む（RFC 6749 §4.1 + PKCE）。**loopback 以外の redirect は拒否。**
/// client_id が空なら「繋げない」と言う（始めてから気付かせない）。
pub fn build_authorize_url(
    config: &ProviderConfig,
    state: &str,
    code_challenge: &str,
) -> Result<String, ConnectorError> {
    if !is_loopback_redirect(&config.redirect_uri) {
        return Err(ConnectorError::NonLoopbackRedirect(config.redirect_uri.clone()));
    }
    if config.client_id.is_empty() {
        return Err(ConnectorError::NoClientId(config.provider.id().to_string()));
    }
    let mut params: Vec<(String, String)> = vec![
        ("response_type".into(), "code".into()),
        ("client_id".into(), config.client_id.clone()),
        ("redirect_uri".into(), config.redirect_uri.clone()),
        ("scope".into(), config.scopes.join(" ")),
        ("state".into(), state.to_string()),
        ("code_challenge".into(), code_challenge.to_string()),
        ("code_challenge_method".into(), "S256".into()),
    ];
    for (k, v) in config.provider.extra_params() {
        params.push((k.to_string(), v.to_string()));
    }
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", form_encode(k), form_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    Ok(format!("{}?{}", config.provider.authorize_url(), query))
}

/// 折り返しを受理してよいか。**state が合わないものを通さない（CSRF）。期限切れも通さない。**
pub fn accept_callback(
    expected_state: &str,
    started_at_ms: u64,
    now_ms: u64,
    params: &crate::oauth::CallbackParams,
) -> Result<String, ConnectorError> {
    if let Some(error) = &params.error {
        // 提供者が断った理由をそのまま伝える。握り潰さない。
        let detail = params.error_description.clone().unwrap_or_else(|| error.clone());
        return Err(ConnectorError::ProviderRefused(detail));
    }
    match &params.state {
        Some(s) if s == expected_state => {}
        _ => return Err(ConnectorError::StateMismatch),
    }
    if now_ms.saturating_sub(started_at_ms) > AUTHORIZATION_TIMEOUT_MS {
        return Err(ConnectorError::TimedOut);
    }
    match &params.code {
        Some(code) if !code.is_empty() => Ok(code.clone()),
        _ => Err(ConnectorError::NoCode),
    }
}

/// 折り返しを待つ上限（5 分）。開きっぱなしを永久に有効にしない。
pub const AUTHORIZATION_TIMEOUT_MS: u64 = 5 * 60 * 1000;

/// env（client_id の一覧）から、繋げる提供者だけを返す。**無いものを既定値で埋めない。**
pub fn configured_providers(env: &BTreeMap<String, String>) -> Vec<OauthProvider> {
    OauthProvider::all()
        .into_iter()
        .filter(|p| env.get(&p.client_id_var()).map(|v| !v.is_empty()).unwrap_or(false))
        .collect()
}

/// どの提供者が繋げないか。設定名まで含めて言う。
pub fn unconfigured_providers(env: &BTreeMap<String, String>) -> Vec<(OauthProvider, String)> {
    let ready: std::collections::BTreeSet<&str> =
        configured_providers(env).iter().map(|p| p.id()).collect();
    OauthProvider::all()
        .into_iter()
        .filter(|p| !ready.contains(p.id()))
        .map(|p| (p, p.client_id_var()))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectorError {
    NonLoopbackRedirect(String),
    NoClientId(String),
    StateMismatch,
    TimedOut,
    NoCode,
    NoAccessToken,
    ProviderRefused(String),
}

impl std::fmt::Display for ConnectorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectorError::NonLoopbackRedirect(u) => write!(f, "redirect_uri must be loopback: {u}"),
            ConnectorError::NoClientId(p) => write!(f, "{p} has no client id configured"),
            ConnectorError::StateMismatch => write!(f, "the callback did not match the request"),
            ConnectorError::TimedOut => write!(f, "this sign-in took too long; start it again"),
            ConnectorError::NoCode => write!(f, "the callback carried no authorization code"),
            ConnectorError::NoAccessToken => write!(f, "the provider returned no access token"),
            ConnectorError::ProviderRefused(d) => write!(f, "{d}"),
        }
    }
}

impl std::error::Error for ConnectorError {}

/// base64url（パディング無し）。PKCE challenge に使う。
fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(n & 63) as usize] as char);
        }
    }
    out
}

/// application/x-www-form-urlencoded の encode（unreserved 以外を %XX に）。
fn form_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// トークン交換の結果。**期限や scope を推測で埋めない**（返らなければ None / 空）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// 提供者が expires_in を返したときだけ、now + expires_in（ms epoch）。無ければ None。
    pub expires_at_ms: Option<u64>,
    /// 実際に許された scope。**要求した分を許されたことにしない。**返らなければ空。
    pub granted_scopes: Vec<String>,
    pub token_type: String,
    /// OpenID の id_token。scope に openid が無ければ None。サインインはこれだけ使う。
    pub id_token: Option<String>,
}

/// token endpoint に送る form パラメータ（RFC 6749 §4.1.3 + PKCE）。**code_verifier を省かない。**
pub fn token_exchange_body(
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("client_id", client_id.to_string()),
        // PKCE。ここを省くと、盗まれたコードがそのまま使える。
        ("code_verifier", code_verifier.to_string()),
    ]
}

/// token endpoint の応答(JSON)を TokenSet へ。error を握り潰さない・期限/ scope を推測しない。
pub fn parse_token_response(json: &str, now_ms: u64) -> Result<TokenSet, ConnectorError> {
    let body: serde_json::Value =
        serde_json::from_str(json).map_err(|_| ConnectorError::ProviderRefused(
            "the provider replied with no readable body".to_string()))?;
    if let Some(error) = body.get("error").and_then(|v| v.as_str()) {
        let detail = body
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or(error);
        return Err(ConnectorError::ProviderRefused(detail.to_string()));
    }
    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ConnectorError::NoAccessToken)?
        .to_string();
    let expires_at_ms = body
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .map(|secs| now_ms + secs * 1000);
    let granted_scopes = body
        .get("scope")
        .and_then(|v| v.as_str())
        .map(|s| s.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();
    Ok(TokenSet {
        access_token,
        refresh_token: body.get("refresh_token").and_then(|v| v.as_str()).map(str::to_string),
        expires_at_ms,
        granted_scopes,
        token_type: body
            .get("token_type")
            .and_then(|v| v.as_str())
            .unwrap_or("Bearer")
            .to_string(),
        id_token: body.get("id_token").and_then(|v| v.as_str()).map(str::to_string),
    })
}

/// 認可コードをトークンに交換する（token endpoint へ POST）。**この HTTP 呼び出しだけが外部依存**
/// （提供者のサーバ）。body 構築と応答 parse は純ドメインで別途テスト済み。
pub fn exchange_code(
    config: &ProviderConfig,
    code: &str,
    code_verifier: &str,
    now_ms: u64,
) -> Result<TokenSet, ConnectorError> {
    let form = token_exchange_body(&config.client_id, &config.redirect_uri, code, code_verifier);
    let form_ref: Vec<(&str, &str)> = form.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let response = ureq::post(config.provider.token_url())
        .set("accept", "application/json")
        .send_form(&form_ref);
    let text = match response {
        Ok(resp) => resp.into_string().map_err(|_| ConnectorError::ProviderRefused(
            "could not read the provider response".to_string()))?,
        // 4xx/5xx でも本文に error があることが多いので読む。
        Err(ureq::Error::Status(_, resp)) => resp.into_string().map_err(|_| {
            ConnectorError::ProviderRefused("the provider replied with no readable body".to_string())
        })?,
        Err(_) => return Err(ConnectorError::ProviderRefused(
            "could not reach the provider".to_string())),
    };
    parse_token_response(&text, now_ms)
}

/// 折り返しの解析結果（UniFFI 用のフラット Record）。crate::oauth::CallbackParams と同じ中身。
#[derive(uniffi::Record, Clone, Debug, Default)]
pub struct OauthCallback {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    pub id_token: Option<String>,
    pub display_name: Option<String>,
}

/// 折り返し URL（`/callback?code=...`）を解析する。解析は core の parse_callback に一本化。
#[uniffi::export]
pub fn connector_parse_callback(target: String) -> OauthCallback {
    let p = crate::oauth::parse_callback(&target);
    OauthCallback {
        code: p.code,
        state: p.state,
        error: p.error,
        error_description: p.error_description,
        id_token: p.id_token,
        display_name: p.display_name,
    }
}

/// UniFFI 用のフラットなラッパー（macOS Swift / Windows が呼ぶ実経路の入口）。
/// PKCE の code_challenge（S256）を作る。
#[uniffi::export]
pub fn connector_pkce_challenge(verifier: String) -> String {
    pkce_challenge(&verifier)
}

/// authorize URL を組む。エラー（非 loopback / client_id 空）は None で返す
/// （UniFFI の Error 型を増やさず、呼び出し側が「繋げない」を扱えるように）。
#[uniffi::export]
pub fn connector_authorize_url(
    provider_id: String,
    client_id: String,
    redirect_uri: String,
    scopes: Vec<String>,
    state: String,
    code_challenge: String,
) -> Option<String> {
    let provider = OauthProvider::from_id(&provider_id)?;
    let config = ProviderConfig { provider, client_id, redirect_uri, scopes };
    build_authorize_url(&config, &state, &code_challenge).ok()
}

/// 繋げる提供者の id 一覧（client_id が env にあるものだけ）。
#[uniffi::export]
pub fn connector_configured_provider_ids(client_ids: std::collections::HashMap<String, String>) -> Vec<String> {
    let env: BTreeMap<String, String> = client_ids.into_iter().collect();
    configured_providers(&env).into_iter().map(|p| p.id().to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::CallbackParams;

    #[test]
    fn pkce_matches_the_rfc7636_test_vector() {
        // RFC 7636 Appendix B。ここがずれると提供者が全部弾く。
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(pkce_challenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn only_loopback_redirects_are_allowed() {
        assert!(is_loopback_redirect("http://127.0.0.1:8123/callback"));
        assert!(is_loopback_redirect("http://[::1]:8123/callback"));
        assert!(!is_loopback_redirect("https://example.com/callback"));
        assert!(!is_loopback_redirect("http://evil.example.com/callback"));
    }

    #[test]
    fn authorize_url_carries_pkce_and_state_and_extras() {
        let config = ProviderConfig {
            provider: OauthProvider::Google,
            client_id: "cid-123.apps.googleusercontent.com".into(),
            redirect_uri: "http://127.0.0.1:8123/callback".into(),
            scopes: vec!["openid".into(), "email".into()],
        };
        let url = build_authorize_url(&config, "state-xyz", "chal-abc").unwrap();
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge=chal-abc"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-xyz"));
        assert!(url.contains("scope=openid%20email"));
        assert!(url.contains("access_type=offline")); // Google の追加
    }

    #[test]
    fn authorize_url_refuses_non_loopback_and_missing_client_id() {
        let bad_redirect = ProviderConfig {
            provider: OauthProvider::Google,
            client_id: "cid".into(),
            redirect_uri: "https://example.com/cb".into(),
            scopes: vec![],
        };
        assert!(build_authorize_url(&bad_redirect, "s", "c").is_err());
        let no_client = ProviderConfig {
            provider: OauthProvider::Google,
            client_id: "".into(),
            redirect_uri: "http://127.0.0.1:1/cb".into(),
            scopes: vec![],
        };
        assert!(matches!(build_authorize_url(&no_client, "s", "c"), Err(ConnectorError::NoClientId(_))));
    }

    #[test]
    fn callback_requires_matching_state_and_code() {
        let ok = CallbackParams { code: Some("abc".into()), state: Some("s".into()), ..Default::default() };
        assert_eq!(accept_callback("s", 0, 1000, &ok).unwrap(), "abc");

        let wrong_state = CallbackParams { code: Some("abc".into()), state: Some("other".into()), ..Default::default() };
        assert_eq!(accept_callback("s", 0, 1000, &wrong_state), Err(ConnectorError::StateMismatch));

        let expired = CallbackParams { code: Some("abc".into()), state: Some("s".into()), ..Default::default() };
        assert_eq!(accept_callback("s", 0, AUTHORIZATION_TIMEOUT_MS + 1, &expired), Err(ConnectorError::TimedOut));

        let refused = CallbackParams { error: Some("access_denied".into()), ..Default::default() };
        assert!(matches!(accept_callback("s", 0, 1, &refused), Err(ConnectorError::ProviderRefused(_))));
    }

    #[test]
    fn token_exchange_body_carries_code_and_pkce_verifier() {
        let body = token_exchange_body("cid", "http://127.0.0.1:1/cb", "auth-code", "verifier-xyz");
        assert!(body.contains(&("grant_type", "authorization_code".to_string())));
        assert!(body.contains(&("code", "auth-code".to_string())));
        assert!(body.contains(&("code_verifier", "verifier-xyz".to_string())));
    }

    #[test]
    fn parses_a_token_response_without_guessing_scope_or_expiry() {
        let json = r#"{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"scope":"openid email","token_type":"Bearer","id_token":"idt-1"}"#;
        let set = parse_token_response(json, 1_000).unwrap();
        assert_eq!(set.access_token, "at-1");
        assert_eq!(set.refresh_token.as_deref(), Some("rt-1"));
        assert_eq!(set.expires_at_ms, Some(1_000 + 3_600_000));
        assert_eq!(set.granted_scopes, vec!["openid".to_string(), "email".to_string()]);
        assert_eq!(set.id_token.as_deref(), Some("idt-1"));

        // scope/expiry が無ければ推測しない
        let minimal = parse_token_response(r#"{"access_token":"at-2"}"#, 5).unwrap();
        assert_eq!(minimal.expires_at_ms, None);
        assert!(minimal.granted_scopes.is_empty());
        assert_eq!(minimal.token_type, "Bearer");
    }

    #[test]
    fn a_token_error_is_surfaced_not_swallowed() {
        let json = r#"{"error":"invalid_grant","error_description":"code expired"}"#;
        assert!(matches!(parse_token_response(json, 0), Err(ConnectorError::ProviderRefused(d)) if d == "code expired"));
        // access_token が無ければ NoAccessToken
        assert_eq!(parse_token_response("{}", 0), Err(ConnectorError::NoAccessToken));
    }

    #[test]
    fn configured_providers_only_lists_those_with_a_client_id() {
        let mut env = BTreeMap::new();
        env.insert("ASTRA_OAUTH_GOOGLE_CLIENT_ID".to_string(), "cid".to_string());
        let ready = configured_providers(&env);
        assert_eq!(ready, vec![OauthProvider::Google]);
        let missing = unconfigured_providers(&env);
        assert_eq!(missing, vec![(OauthProvider::Microsoft, "ASTRA_OAUTH_MICROSOFT_CLIENT_ID".to_string())]);
    }
}
