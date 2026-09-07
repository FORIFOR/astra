import Foundation
import AstraCore

/// SwiftUI/ViewModel と astra-core(UniFFI) の間の薄い層。
/// View から FFI を直接呼ばず、ここを通す（SwiftUI → AstraCoreBridge → UniFFI → Rust）。
enum AstraCoreBridge {
    /// 疎通確認にも使う core のバージョン。
    static var coreVersion: String { astraCoreVersion() }

    /// 録音の生の状態 → 表示（経過ラベル・状態文・オフライン表示）。派生の実装は Rust に一本化。
    static func snapshot(
        elapsedMs: UInt64, isPaused: Bool, link: LinkState, pendingMs: UInt64
    ) -> RecordingSnapshot {
        recordingSnapshot(input: RecordingInput(
            elapsedMs: elapsedMs, isPaused: isPaused, link: link, pendingMs: pendingMs))
    }

    /// 前回落ちたまま残っている録音。
    static func recoverable(root: String, active: String?) -> [RecoverableMeeting] {
        scanRecoverable(root: root, active: active)
    }
    /// gateway へ送り終えた会議を「アップロード済み」に印す（二重回復を防ぐ）。
    @discardableResult
    static func markUploaded(root: String, meetingId: String) -> Bool {
        markMeetingUploaded(root: root, meetingId: meetingId)
    }

    // gateway（実バックエンド）を core 経由で叩く。Tauri を介さない。
    static func reachable(_ baseUrl: String) -> Bool { apiReachable(baseUrl: baseUrl) }
    static func devSignIn(_ baseUrl: String, email: String, displayName: String) throws -> Tokens {
        try apiDevSignIn(baseUrl: baseUrl, email: email, displayName: displayName)
    }
    static func me(_ baseUrl: String, accessToken: String) throws -> Me {
        try apiMe(baseUrl: baseUrl, accessToken: accessToken)
    }
    static func createMeeting(_ baseUrl: String, accessToken: String, title: String, language: String) throws -> String {
        try apiCreateMeeting(baseUrl: baseUrl, accessToken: accessToken, title: title, language: language)
    }
    static func finishMeeting(_ baseUrl: String, accessToken: String, meetingId: String) throws -> String {
        try apiFinishMeeting(baseUrl: baseUrl, accessToken: accessToken, meetingId: meetingId)
    }
    static func uploadMeetingAudio(_ baseUrl: String, accessToken: String, meetingId: String, journalRoot: String) throws -> UInt64 {
        try apiUploadMeetingAudio(baseUrl: baseUrl, accessToken: accessToken, meetingId: meetingId, journalRoot: journalRoot)
    }
    static func startConversation(_ baseUrl: String, accessToken: String) throws -> String {
        try apiStartConversation(baseUrl: baseUrl, accessToken: accessToken)
    }
    /// 依頼を送る。`attachments` は端末内の画像の id とラベルだけ（画素は端末に残る）。
    static func sendTurn(_ baseUrl: String, accessToken: String, conversationId: String, text: String,
                         attachments: [TurnAttachment] = []) throws -> TurnOutcome {
        attachments.isEmpty
            ? try apiSendTurn(baseUrl: baseUrl, accessToken: accessToken, conversationId: conversationId, text: text)
            : try apiSendTurnWithAttachments(baseUrl: baseUrl, accessToken: accessToken, conversationId: conversationId,
                                             text: text, attachments: attachments)
    }
    static func pluginCatalog(_ baseUrl: String, accessToken: String) throws -> [String] {
        try apiPluginCatalog(baseUrl: baseUrl, accessToken: accessToken)
    }
    static func createTask(_ baseUrl: String, accessToken: String, kind: String, inputJson: String) throws -> String {
        try apiCreateTask(baseUrl: baseUrl, accessToken: accessToken, kind: kind, inputJson: inputJson)
    }
    static func waitTask(_ baseUrl: String, accessToken: String, taskId: String, timeoutMs: UInt64) throws -> TaskStatus {
        try apiWaitTask(baseUrl: baseUrl, accessToken: accessToken, taskId: taskId, timeoutMs: timeoutMs)
    }
    static func artifactContent(_ baseUrl: String, accessToken: String, artifactId: String) throws -> String {
        try apiArtifactContent(baseUrl: baseUrl, accessToken: accessToken, artifactId: artifactId)
    }
    // connector（外部サービス連携）の契約層。authorize URL 組み立て・PKCE は core が正本。
    // live なトークン交換は提供者ごとの外部処理で、ここには持たない。
    static func pkceChallenge(_ verifier: String) -> String { connectorPkceChallenge(verifier: verifier) }
    static func authorizeUrl(provider: String, clientId: String, redirectUri: String,
                             scopes: [String], state: String, codeChallenge: String) -> String? {
        connectorAuthorizeUrl(providerId: provider, clientId: clientId, redirectUri: redirectUri,
                              scopes: scopes, state: state, codeChallenge: codeChallenge)
    }
    static func configuredProviders(_ clientIds: [String: String]) -> [String] {
        connectorConfiguredProviderIds(clientIds: clientIds)
    }
    static func tokenUrl(provider: String) -> String? { connectorTokenUrl(providerId: provider) }
    /// 認可コードをトークンへ（PKCE）。失敗は空文字。
    static func exchangeCode(tokenUrl: String, provider: String, clientId: String, redirectUri: String,
                             code: String, verifier: String) -> String {
        connectorExchangeCode(tokenUrl: tokenUrl, providerId: provider, clientId: clientId, redirectUri: redirectUri,
                              code: code, codeVerifier: verifier, nowMs: UInt64(Date().timeIntervalSince1970 * 1000))
    }
    static func pluginConnections(_ baseUrl: String, accessToken: String, pluginId: String) throws -> String {
        try apiPluginConnections(baseUrl: baseUrl, accessToken: accessToken, pluginId: pluginId)
    }
    static func pluginConnect(_ baseUrl: String, accessToken: String, pluginId: String, connectJson: String) throws -> String {
        try apiPluginConnect(baseUrl: baseUrl, accessToken: accessToken, pluginId: pluginId, connectJson: connectJson)
    }
    static func pluginDisconnect(_ baseUrl: String, accessToken: String, pluginId: String, connectorId: String) throws {
        try apiPluginDisconnect(baseUrl: baseUrl, accessToken: accessToken, pluginId: pluginId, connectorId: connectorId)
    }

    /// RAG コンテキストの並べ替え（決定的）。ランキングは core に一本化する。
    /// 語彙一致・新しさ・プロジェクト一致 × source 重みで採点し、上位を返す。
    static func rankContext(terms: [String], limit: UInt32, candidates: [ContextCandidate]) -> [ContextResult] {
        AstraCore.rankContext(query: ContextQuery(terms: terms, limit: limit), candidates: candidates)
    }

    static func library(_ baseUrl: String, accessToken: String) throws -> [String] {
        try apiLibrary(baseUrl: baseUrl, accessToken: accessToken)
    }

    // Work Context / Personalization。形は契約（@astra/contracts work.ts）が正本なので JSON のまま運ぶ。
    static func workContext(_ baseUrl: String, accessToken: String) throws -> String {
        try apiWorkContext(baseUrl: baseUrl, accessToken: accessToken)
    }
    static func workEvidence(_ baseUrl: String, accessToken: String, itemId: String) throws -> String {
        try apiWorkEvidence(baseUrl: baseUrl, accessToken: accessToken, itemId: itemId)
    }
    static func workCorrect(_ baseUrl: String, accessToken: String, itemId: String, action: String, note: String) throws {
        try apiWorkCorrect(baseUrl: baseUrl, accessToken: accessToken, itemId: itemId, action: action, note: note)
    }
    static func personalization(_ baseUrl: String, accessToken: String) throws -> String {
        try apiPersonalization(baseUrl: baseUrl, accessToken: accessToken)
    }
    static func personalizationUpdate(_ baseUrl: String, accessToken: String, updateJson: String) throws -> String {
        try apiPersonalizationUpdate(baseUrl: baseUrl, accessToken: accessToken, updateJson: updateJson)
    }
}
