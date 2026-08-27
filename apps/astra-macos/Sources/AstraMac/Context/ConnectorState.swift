import Foundation
import AstraCore

/// Apps/Connectors の接続状態。どのプロバイダが設定済み（client_id が env にある）かを core に聞き、
/// トグルは**設定済みのものだけ**接続開始できる（**繋げないものを繋いだつもりにさせない**、§21）。
/// 実際の接続は ConnectorFlow（OAuth）。トークンは Keychain のみ。
@MainActor
final class ConnectorState: ObservableObject {
    static let shared = ConnectorState()
    /// 接続済み（このセッションで OAuth を完了した）アプリ名。
    @Published var connected: Set<String> = []
    private let flow = ConnectorFlow()

    /// アプリ名 → OAuth プロバイダ（緩いマッピング）。未対応は nil。
    static func provider(for app: String) -> String? {
        let a = app.lowercased()
        if a.contains("gmail") || a.contains("google") || a.contains("calendar") || a.contains("drive") { return "google" }
        if a.contains("microsoft") || a.contains("outlook") || a.contains("teams") { return "microsoft" }
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

    /// 接続を始める（設定済みのときだけ）。OAuth をブラウザで開始する。成功で true。
    @discardableResult
    func connect(_ app: String) -> Bool {
        guard let provider = Self.provider(for: app), canConnect(app) else { return false }
        let clientId = ProcessInfo.processInfo.environment["ASTRA_OAUTH_\(provider.uppercased())_CLIENT_ID"] ?? ""
        let scopes = provider == "google" ? ["openid", "email"] : ["openid", "email"]
        let ok = (try? flow.begin(provider: provider, clientId: clientId, scopes: scopes) { _, _ in
            // 折り返しを受けたら（トークン交換は core、提供者が揃ったとき）接続済みにする。
        }) ?? false
        return ok
    }
}
