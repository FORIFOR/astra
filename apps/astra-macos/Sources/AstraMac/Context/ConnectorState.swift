import Foundation
import AstraCore

/// Apps/Connectors の接続状態と、実際に繋ぐ経路。正本 §21、Work Context 仕様「read-only first」。
///
/// 事実の出所は 2 つだけ:
///   - **cloud の接続記録**（`GET /v1/plugins/:id/connections`、実際に許された scope）— 表示の正本
///   - **この Mac の Keychain**（`com.astra.connector.<plugin>/<connector>`、端末 worker と同じ項目）— トークンの在処
/// 「繋いだつもり」を作らない: 記録も鍵も無ければ未接続。client_id が無ければ繋げない、と言う。
///
/// 繋ぐときは manifest の**読むだけの接続**（`connectors[].grants` が全部 `.read`）の scope だけを求める。
/// 送る・作る接続は、送る操作が要ったときに purpose を見せてから別に求める（JIT）。
@MainActor
final class ConnectorState: ObservableObject {
    static let shared = ConnectorState()

    /// Work Context が読む source。順番は画面の順。
    struct Source: Identifiable, Equatable {
        let pluginId: String
        let name: String
        /// 接続が読むもの（manifest の purpose）。
        let purpose: String
        let provider: String
        let connectorId: String
        let scopes: [String]
        var id: String { pluginId }
    }

    enum Status: Equatable { case connected, disconnected, cannotConnect, connecting, failed(String) }

    /// 接続済み（このセッションで OAuth を完了した / cloud の記録がある）アプリ名。既存の面と selftest が見る。
    @Published var connected: Set<String> = []
    @Published private(set) var status: [String: Status] = [:]
    @Published private(set) var sources: [Source] = []
    private let flow = ConnectorFlow()
    private var base: String?
    private var token: String?

    init() {
        reloadSources()
    }

    /// manifest から読む接続を組む。読める plugin だけ（推測で足さない）。
    func reloadSources() {
        let store = PluginRuntimeStore.shared
        store.load()
        let order = ["com.astra.gmail", "com.astra.google-calendar", "com.astra.outlook", "com.astra.microsoft-todo"]
        sources = order.compactMap { id in
            guard let m = store.manifests.first(where: { $0.id == id }), let c = m.readConnector else { return nil }
            return Source(pluginId: id, name: m.name, purpose: c.purpose ?? "読むだけ", provider: c.provider,
                          connectorId: c.id, scopes: c.scopes)
        }
        for s in sources where status[s.pluginId] == nil {
            status[s.pluginId] = hasToken(s) ? .connected : (canConnect(s.name) ? .disconnected : .cannotConnect)
        }
    }

    /// アプリ名 → OAuth プロバイダ（緩いマッピング）。未対応は nil。
    static func provider(for app: String) -> String? {
        let a = app.lowercased()
        if a.contains("gmail") || a.contains("google") || a.contains("calendar") || a.contains("drive") { return "google" }
        if a.contains("microsoft") || a.contains("outlook") || a.contains("teams") || a.contains("to do") { return "microsoft" }
        return nil
    }

    /// env にある client_id 一覧（`ASTRA_OAUTH_*_CLIENT_ID`）。
    private func clientIds() -> [String: String] {
        var out: [String: String] = [:]
        for (k, v) in ProcessInfo.processInfo.environment where k.hasPrefix("ASTRA_OAUTH_") && k.hasSuffix("_CLIENT_ID") {
            out[k] = v
        }
        return out
    }

    /// 設定済み（繋げる）プロバイダ id。判定は core に一本化。
    func configuredProviders() -> [String] {
        AstraCoreBridge.configuredProviders(clientIds())
    }

    /// このアプリを今すぐ繋げるか（対応プロバイダがあり、その client_id が設定済み）。
    func canConnect(_ app: String) -> Bool {
        guard let p = Self.provider(for: app) else { return false }
        return configuredProviders().contains(p)
    }

    func source(named app: String) -> Source? { sources.first { $0.name == app } }
    func status(of app: String) -> Status? { source(named: app).flatMap { status[$0.pluginId] } }

    private func hasToken(_ s: Source) -> Bool {
        KeychainStore.hasGeneric(service: KeychainStore.connectorService(s.pluginId, s.connectorId), account: NSUserName())
    }

    // MARK: cloud

    func configureBackend(base: String, token: String) {
        self.base = base; self.token = token
        refresh()
    }

    /// cloud の接続記録を読み直す。読めなければ手元の鍵の有無だけで言う。
    func refresh() {
        guard let base, let token else { return }
        let list = sources
        Task.detached { [list] in
            var next: [String: Bool] = [:]
            for s in list {
                guard let text = try? AstraCoreBridge.pluginConnections(base, accessToken: token, pluginId: s.pluginId),
                      let data = text.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let items = obj["items"] as? [[String: Any]] else { continue }
                next[s.pluginId] = items.contains { ($0["connectorId"] as? String) == s.connectorId && ($0["state"] as? String) == "CONNECTED" }
            }
            await MainActor.run {
                for s in list {
                    guard let recorded = next[s.pluginId] else { continue }
                    if case .connecting = self.status[s.pluginId] { continue }
                    let live = recorded && self.hasToken(s)
                    self.status[s.pluginId] = live ? .connected : (self.canConnect(s.name) ? .disconnected : .cannotConnect)
                    if live { self.connected.insert(s.name) } else { self.connected.remove(s.name) }
                }
            }
        }
    }

    // MARK: connect / disconnect

    /// 接続を始める（設定済みのときだけ）。**読むだけの接続の scope だけ**を求める。成功で true。
    @discardableResult
    func connect(_ app: String) -> Bool {
        guard let s = source(named: app) else { return false }
        return connect(source: s)
    }

    @discardableResult
    func connect(source s: Source) -> Bool {
        guard canConnect(s.name) else { status[s.pluginId] = .cannotConnect; return false }
        let clientId = ProcessInfo.processInfo.environment["ASTRA_OAUTH_\(s.provider.uppercased())_CLIENT_ID"] ?? ""
        guard let tokenUrl = AstraCoreBridge.tokenUrl(provider: s.provider) else { return false }
        status[s.pluginId] = .connecting
        let ok = (try? flow.begin(provider: s.provider, clientId: clientId, scopes: s.scopes) { [weak self] callback, pending in
            Task { @MainActor in
                guard let self else { return }
                self.flow.stopLoopback()
                self.finish(source: s, callback: callback, pending: pending, clientId: clientId, tokenUrl: tokenUrl)
            }
        }) ?? false
        if !ok { status[s.pluginId] = .failed("ブラウザで同意画面を開けませんでした") }
        return ok
    }

    /// 折り返し → 交換 → Keychain → cloud の記録。**参照だけを cloud へ。**
    private func finish(source s: Source, callback: OauthCallback, pending: ConnectorFlow.Pending, clientId: String, tokenUrl: String) {
        if let error = callback.error {
            status[s.pluginId] = .failed(callback.errorDescription ?? error); return
        }
        guard callback.state == pending.state, let code = callback.code else {
            status[s.pluginId] = .failed("折り返しが合いませんでした（state）"); return
        }
        let json = AstraCoreBridge.exchangeCode(tokenUrl: tokenUrl, provider: s.provider, clientId: clientId,
                                                redirectUri: pending.redirectUri, code: code, verifier: pending.verifier)
        guard let data = json.data(using: .utf8), !json.isEmpty,
              let t = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = t["access_token"] as? String else {
            status[s.pluginId] = .failed("トークンを受け取れませんでした"); return
        }
        let granted = (t["granted_scopes"] as? [String]) ?? []
        let expiresAt: String? = (t["expires_at_ms"] as? Double).map {
            ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: $0 / 1000))
        }
        // 端末 worker と同じ形（@astra/oauth TokenSet）。値はここ（Keychain）にだけ置く。
        let stored: [String: Any] = [
            "accessToken": access,
            "refreshToken": t["refresh_token"] as? String ?? NSNull(),
            "expiresAt": expiresAt ?? NSNull(),
            "grantedScopes": granted,
            "tokenType": t["token_type"] as? String ?? "Bearer",
            "idToken": NSNull(),
        ]
        guard let storedData = try? JSONSerialization.data(withJSONObject: stored),
              let storedText = String(data: storedData, encoding: .utf8) else { status[s.pluginId] = .failed("保存できませんでした"); return }
        do {
            try KeychainStore.setGeneric(service: KeychainStore.connectorService(s.pluginId, s.connectorId), account: NSUserName(), value: storedText)
        } catch {
            status[s.pluginId] = .failed("Keychain に保存できませんでした"); return
        }
        if let base, let token {
            let body: [String: Any] = [
                "connector_id": s.connectorId,
                "credential_ref": "keychain:\(s.pluginId)/\(s.connectorId)",
                "granted_scopes": granted,
                "expires_at": expiresAt ?? NSNull(),
            ]
            if let bodyData = try? JSONSerialization.data(withJSONObject: body), let bodyText = String(data: bodyData, encoding: .utf8) {
                do { _ = try AstraCoreBridge.pluginConnect(base, accessToken: token, pluginId: s.pluginId, connectJson: bodyText) }
                catch { status[s.pluginId] = .failed("接続を記録できませんでした"); return }
            }
        }
        status[s.pluginId] = .connected
        connected.insert(s.name)
    }

    /// 切る: 鍵を消し、cloud の記録を失効させる。
    func disconnect(_ app: String) {
        guard let s = source(named: app) else { connected.remove(app); return }
        try? KeychainStore.deleteGeneric(service: KeychainStore.connectorService(s.pluginId, s.connectorId), account: NSUserName())
        if let base, let token {
            try? AstraCoreBridge.pluginDisconnect(base, accessToken: token, pluginId: s.pluginId, connectorId: s.connectorId)
        }
        status[s.pluginId] = canConnect(s.name) ? .disconnected : .cannotConnect
        connected.remove(s.name)
    }

    /// 検査用: 状態を直に置く（OAuth 無しで面を撮る）。
    func installStatus(_ pluginId: String, _ st: Status) {
        status[pluginId] = st
        if let s = sources.first(where: { $0.pluginId == pluginId }) {
            if st == .connected { connected.insert(s.name) } else { connected.remove(s.name) }
        }
    }
}
