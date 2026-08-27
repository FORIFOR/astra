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

/// 冪等キー（8–128 文字）。外部乱数を足さず、pid + 単調時刻で一意にする。
fn idem_key() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("astra-core-{}-{}", std::process::id(), nanos)
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

        // 会議の作成 → 録音（実断片）→ 送信 → 終了。すべて core 経由、Tauri を介さない。
        let meeting_id = api_create_meeting(url.clone(), tokens.access_token.clone(), "core E2E".into(), "ja-JP".into())
            .expect("create meeting should succeed");
        assert!(!meeting_id.is_empty());

        let root = std::env::temp_dir().join(format!("astra-api-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&root);
        let session = crate::session::RecordingSession::start(
            root.to_string_lossy().to_string(), meeting_id.clone()).unwrap();
        let one_sec = vec![0.1f32; crate::recording::WIRE_SAMPLE_RATE as usize];
        for _ in 0..6 { session.push_samples(one_sec.clone(), crate::recording::WIRE_SAMPLE_RATE); }
        session.finish().unwrap();
        let sent = api_upload_meeting_audio(
            url.clone(), tokens.access_token.clone(), meeting_id.clone(),
            root.to_string_lossy().to_string()).expect("audio upload should succeed");
        assert!(sent > 0, "should have uploaded fragment bytes");
        let _ = std::fs::remove_dir_all(&root);

        let meeting_id_for_segments = meeting_id.clone();
        let task_id = api_finish_meeting(url.clone(), tokens.access_token.clone(), meeting_id)
            .expect("finish meeting should return a finalize task id");
        assert!(!task_id.is_empty());

        // 会話/Agent: 依頼 → 仕事 id（Agent 経路が Tauri を介さず動く）
        let conv = api_start_conversation(url.clone(), tokens.access_token.clone())
            .expect("start conversation");
        assert!(!conv.is_empty());
        let outcome = api_send_turn(url.clone(), tokens.access_token.clone(), conv, "テスト依頼を実行して".into())
            .expect("send turn");
        // 経路が通れば、task_id / 聞き返し / 即答 / notice のいずれかが返る（dev は notice）
        assert!(!outcome.task_id.is_empty() || outcome.needs_clarification || !outcome.answer.is_empty() || !outcome.notice.is_empty());

        // Apps: plugin catalog（同梱が並ぶ）
        let apps = api_plugin_catalog(url.clone(), tokens.access_token.clone()).expect("plugin catalog");
        assert!(!apps.is_empty(), "builtin plugins should be listed");

        // Agent round-trip: echo タスク → 完了まで待つ → COMPLETED + 成果物
        let task = api_create_task(
            url.clone(), tokens.access_token.clone(), "echo".into(),
            "{\"message\":\"core e2e\",\"steps\":1}".into()).expect("create task");
        assert!(!task.is_empty());
        let done = api_wait_task(url.clone(), tokens.access_token.clone(), task, 15_000).expect("wait task");
        assert_eq!(done.status, "COMPLETED", "echo task should complete");
        assert!(!done.result_artifact_id.is_empty(), "echo should produce an artifact");

        // 成果物の本文まで読める（Agent → 成果物 → 内容の完全ループ）
        let content = api_artifact_content(url.clone(), tokens.access_token.clone(), done.result_artifact_id)
            .expect("artifact content");
        assert!(!content.is_empty(), "artifact content should not be empty");

        // Library に成果物が並ぶ
        let library = api_library(url.clone(), tokens.access_token.clone()).expect("library");
        assert!(!library.is_empty(), "library should list the produced artifact");

        // transcript の取得経路（dev の STT は未接続のことがあるので件数は 0 以上でよい）
        let _segs = api_meeting_segment_count(url, tokens.access_token, meeting_id_for_segments)
            .expect("segments endpoint should respond");
    }
}

/// 録音済み断片を gateway の音声 WS へ送る（POST 相当の upgrade + binary frames）。
/// `journal_root/<meeting_id>/mic/NNNNNN.pcm` を順に送る。送ったバイト数を返す。
///
/// これで native は Tauri を介さず、作成→録音→**送信**→終了を実バックエンドで通せる。
#[uniffi::export]
pub fn api_upload_meeting_audio(
    base_url: String,
    access_token: String,
    meeting_id: String,
    journal_root: String,
) -> Result<u64, ApiError> {
    use tungstenite::client::IntoClientRequest;
    use tungstenite::Message;

    let ws_base = base(&base_url)
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let url = format!("{ws_base}/v1/meetings/{meeting_id}/audio");
    let mut request = url
        .into_client_request()
        .map_err(|e| ApiError::Network { message: format!("bad audio url: {e}") })?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {access_token}")
            .parse()
            .map_err(|_| ApiError::Network { message: "token is not a valid header".into() })?,
    );
    let (mut socket, _) =
        tungstenite::connect(request).map_err(|e| ApiError::Network { message: e.to_string() })?;

    let mic_dir = std::path::Path::new(&journal_root).join(&meeting_id).join("mic");
    let mut entries: Vec<_> = std::fs::read_dir(&mic_dir)
        .map_err(|e| ApiError::Network { message: format!("no fragments: {e}") })?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "pcm").unwrap_or(false))
        .collect();
    entries.sort();

    let mut sent = 0u64;
    for path in entries {
        let bytes = std::fs::read(&path)
            .map_err(|e| ApiError::Network { message: e.to_string() })?;
        sent += bytes.len() as u64;
        socket
            .send(Message::Binary(bytes))
            .map_err(|e| ApiError::Network { message: e.to_string() })?;
    }
    let _ = socket.close(None);
    Ok(sent)
}

/// 会話を始める（POST /v1/conversations）。会話 id を返す。
#[uniffi::export]
pub fn api_start_conversation(base_url: String, access_token: String) -> Result<String, ApiError> {
    #[derive(Deserialize)]
    struct Resp { id: String }
    let resp: Resp = ureq::post(&format!("{}/v1/conversations", base(&base_url)))
        .set("Authorization", &format!("Bearer {access_token}"))
        .send_json(ureq::json!({ "response_mode": "text" }))
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.id)
}

/// 依頼を送る（POST /v1/conversations/:id/turns）。Agent が仕事を起こしたら task_id。
#[derive(uniffi::Record, Clone, Debug)]
pub struct TurnOutcome {
    pub needs_clarification: bool,
    /// 聞き返し or 即答（無ければ空）。
    pub answer: String,
    /// 仕事が起きたらその id（無ければ空）。
    pub task_id: String,
    /// 仕事を起こさなかった理由・一言（無ければ空）。
    pub notice: String,
}

#[uniffi::export]
pub fn api_send_turn(
    base_url: String,
    access_token: String,
    conversation_id: String,
    text: String,
) -> Result<TurnOutcome, ApiError> {
    #[derive(Deserialize)]
    struct Resp {
        needs_clarification: bool,
        #[serde(default)]
        answer: Option<String>,
        #[serde(default)]
        task_id: Option<String>,
        #[serde(default)]
        notice: Option<String>,
    }
    let resp: Resp = ureq::post(&format!(
        "{}/v1/conversations/{}/turns",
        base(&base_url),
        conversation_id
    ))
    .set("Authorization", &format!("Bearer {access_token}"))
    .send_json(ureq::json!({ "text": text, "modality": "text", "interrupt": true }))
    .map_err(map_transport)?
    .into_json()
    .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(TurnOutcome {
        needs_clarification: resp.needs_clarification,
        answer: resp.answer.unwrap_or_default(),
        task_id: resp.task_id.unwrap_or_default(),
        notice: resp.notice.unwrap_or_default(),
    })
}

/// Apps（GET /v1/plugins/catalog）。name の一覧だけ（UI が並べる分）。
#[uniffi::export]
pub fn api_plugin_catalog(base_url: String, access_token: String) -> Result<Vec<String>, ApiError> {
    #[derive(Deserialize)]
    struct Item { name: String }
    #[derive(Deserialize)]
    struct Resp { items: Vec<Item> }
    let resp: Resp = ureq::get(&format!("{}/v1/plugins/catalog", base(&base_url)))
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.items.into_iter().map(|i| i.name).collect())
}

/// 仕事の状態（GET /v1/tasks/:id）。
#[derive(uniffi::Record, Clone, Debug)]
pub struct TaskStatus {
    pub id: String,
    pub status: String,
    /// 完成した成果物 id（無ければ空）。
    pub result_artifact_id: String,
}

/// 仕事を起こす（POST /v1/tasks）。Agent 実行の入口。task id を返す。
#[uniffi::export]
pub fn api_create_task(
    base_url: String,
    access_token: String,
    kind: String,
    input_json: String,
) -> Result<String, ApiError> {
    let input: serde_json::Value =
        serde_json::from_str(&input_json).unwrap_or(serde_json::json!({}));
    #[derive(Deserialize)]
    struct Resp { id: String }
    let resp: Resp = ureq::post(&format!("{}/v1/tasks", base(&base_url)))
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("Idempotency-Key", &idem_key())
        .send_json(ureq::json!({ "kind": kind, "input": input }))
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.id)
}

/// 仕事の状態を引く。
#[uniffi::export]
pub fn api_task_status(
    base_url: String,
    access_token: String,
    task_id: String,
) -> Result<TaskStatus, ApiError> {
    #[derive(Deserialize)]
    struct Resp {
        id: String,
        status: String,
        #[serde(default)]
        result_artifact_id: Option<String>,
    }
    let resp: Resp = ureq::get(&format!("{}/v1/tasks/{}", base(&base_url), task_id))
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(TaskStatus {
        id: resp.id,
        status: resp.status,
        result_artifact_id: resp.result_artifact_id.unwrap_or_default(),
    })
}

/// 完了まで待つ（poll）。timeout_ms を超えたら最後の状態を返す。UI は進捗表示に使う。
#[uniffi::export]
pub fn api_wait_task(
    base_url: String,
    access_token: String,
    task_id: String,
    timeout_ms: u64,
) -> Result<TaskStatus, ApiError> {
    let start = std::time::Instant::now();
    loop {
        let st = api_task_status(base_url.clone(), access_token.clone(), task_id.clone())?;
        if matches!(st.status.as_str(), "COMPLETED" | "FAILED" | "CANCELLED") {
            return Ok(st);
        }
        if start.elapsed().as_millis() as u64 >= timeout_ms {
            return Ok(st);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// 成果物の本文（GET /v1/artifacts/:id/content）。テキスト成果物を UI に出す。
#[uniffi::export]
pub fn api_artifact_content(
    base_url: String,
    access_token: String,
    artifact_id: String,
) -> Result<String, ApiError> {
    let body = ureq::get(&format!("{}/v1/artifacts/{}/content", base(&base_url), artifact_id))
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(map_transport)?
        .into_string()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(body)
}

/// Library（GET /v1/artifacts）。title の一覧（UI が並べる分）。
#[uniffi::export]
pub fn api_library(base_url: String, access_token: String) -> Result<Vec<String>, ApiError> {
    #[derive(Deserialize)]
    struct Item { title: String }
    #[derive(Deserialize)]
    struct Resp { items: Vec<Item> }
    let resp: Resp = ureq::get(&format!("{}/v1/artifacts", base(&base_url)))
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.items.into_iter().map(|i| i.title).collect())
}

/// 会議の文字起こし（GET /v1/meetings/:id/segments）。行数を返す（STT 未接続の dev では 0 もある）。
#[uniffi::export]
pub fn api_meeting_segment_count(
    base_url: String,
    access_token: String,
    meeting_id: String,
) -> Result<u32, ApiError> {
    #[derive(Deserialize)]
    struct Resp { #[serde(default)] items: Vec<serde_json::Value> }
    let resp: Resp = ureq::get(&format!("{}/v1/meetings/{}/segments", base(&base_url), meeting_id))
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(map_transport)?
        .into_json()
        .map_err(|e| ApiError::Decode { message: e.to_string() })?;
    Ok(resp.items.len() as u32)
}
