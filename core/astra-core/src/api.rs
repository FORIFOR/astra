//! gateway（実バックエンド）を叩く OS 非依存の API クライアント。
//!
//! Tauri の React/TS client と同じ gateway を、native アプリも **同じ core** から使う（二重実装しない）。
//! ここは HTTP と JSON だけ。UI も Tauri も知らない。認証トークンは呼び出し側（OS の Keychain）が持つ。

use serde::Deserialize;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum ApiError {
    #[error("network error: {message}")]
    Network { message: String },
    #[error("server error {status}: {message}")]
    Server { status: u16, message: String },
    #[error("unexpected response: {message}")]
    Decode { message: String },
}

/// dev サインインで得るトークン一式。
#[derive(uniffi::Record, Clone, Debug)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub device_token: String,
    pub expires_in: i64,
}

/// /v1/me の要点（UI が出す分だけ）。
#[derive(uniffi::Record, Clone, Debug)]
pub struct Me {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
    pub tenant_id: String,
    pub tenant_name: String,
    pub role: String,
}

fn base(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn map_transport(e: ureq::Error) -> ApiError {
    match e {
        ureq::Error::Status(code, resp) => {
            let msg = resp.into_string().unwrap_or_default();
            ApiError::Server { status: code, message: msg }
        }
        ureq::Error::Transport(t) => ApiError::Network { message: t.to_string() },
    }
}

/// 開発用サインイン（POST /v1/auth/dev/token）。gateway が dev token を許すときだけ。
#[uniffi::export]
pub fn api_dev_sign_in(base_url: String, email: String, display_name: String) -> Result<Tokens, ApiError> {
    #[derive(Deserialize)]
    struct Resp {
        access_token: String,
        refresh_token: String,
        device_token: String,
        expires_in: i64,
    }
    let resp: Resp = ureq::post(&format!("{}/v1/auth/dev/token", base(&base_url)))
        .send_json(ureq::json!({ "email": email, "display_name": display_name }))
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(Tokens {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        device_token: resp.device_token,
        expires_in: resp.expires_in,
    })
}

/// 自分の情報（GET /v1/me）。access token が要る。
#[uniffi::export]
pub fn api_me(base_url: String, access_token: String) -> Result<Me, ApiError> {
    #[derive(Deserialize)]
    struct User { id: String, email: String, display_name: String }
    #[derive(Deserialize)]
    struct Tenant { id: String, name: String }
    #[derive(Deserialize)]
    struct Resp { user: User, tenant: Tenant, role: String }
    let resp: Resp = ureq::get(&format!("{}/v1/me", base(&base_url)))
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(Me {
        user_id: resp.user.id,
        email: resp.user.email,
        display_name: resp.user.display_name,
        tenant_id: resp.tenant.id,
        tenant_name: resp.tenant.name,
        role: resp.role,
    })
}

/// 会議（POST /v1/meetings）。同意確認済みでのみ開始する。
#[uniffi::export]
pub fn api_create_meeting(
    base_url: String,
    access_token: String,
    title: String,
    language: String,
) -> Result<String, ApiError> {
    #[derive(Deserialize)]
    struct Resp { id: String }
    let resp: Resp = ureq::post(&format!("{}/v1/meetings", base(&base_url)))
        .set("Authorization", &format!("Bearer {access_token}"))
        .send_json(ureq::json!({
            "title": title,
            "language": language,
            "audio_sources": ["microphone"],
            "consent_confirmed": true,
        }))
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.id)
}

/// 会議を終える（POST /v1/meetings/:id/finish）。finalize task の id を返す。
#[uniffi::export]
pub fn api_finish_meeting(
    base_url: String,
    access_token: String,
    meeting_id: String,
) -> Result<String, ApiError> {
    #[derive(Deserialize)]
    struct Resp { task_id: String }
    let resp: Resp = ureq::post(&format!("{}/v1/meetings/{}/finish", base(&base_url), meeting_id))
        .set("Authorization", &format!("Bearer {access_token}"))
        .send_json(ureq::json!({}))
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.task_id)
}

/// gateway に届くか（GET /v1/auth/providers, 認証不要）。オフライン判定に。
#[uniffi::export]
pub fn api_reachable(base_url: String) -> bool {
    ureq::get(&format!("{}/v1/auth/providers", base(&base_url)))
        .timeout(std::time::Duration::from_secs(3))
        .call()
        .is_ok()
}

// gateway を起動して実行する結合テスト。`ASTRA_GATEWAY_URL` が無ければ skip。
#[cfg(test)]
mod tests {
    use super::*;

    fn gateway() -> Option<String> {
        std::env::var("ASTRA_GATEWAY_URL").ok().filter(|s| !s.is_empty())
    }

    #[test]
    fn dev_sign_in_then_me_round_trips_through_the_real_gateway() {
        let Some(url) = gateway() else {
            eprintln!("skip: set ASTRA_GATEWAY_URL to run against a live gateway");
            return;
        };
        let email = format!("core-api-{}@astra.local", std::process::id());
        let tokens = api_dev_sign_in(url.clone(), email.clone(), "Core API".into())
            .expect("dev sign-in should succeed against a live gateway");
        assert!(!tokens.access_token.is_empty());
        let me = api_me(url.clone(), tokens.access_token.clone()).expect("/v1/me should succeed");
        assert_eq!(me.email, email);
        assert_eq!(me.role, "owner");

        // 会議の作成 → 終了（control plane が Tauri を介さず動く）
        let meeting_id = api_create_meeting(url.clone(), tokens.access_token.clone(), "core E2E".into(), "ja-JP".into())
            .expect("create meeting should succeed");
        assert!(!meeting_id.is_empty());
        let task_id = api_finish_meeting(url, tokens.access_token, meeting_id)
            .expect("finish meeting should return a finalize task id");
        assert!(!task_id.is_empty());
    }
}
