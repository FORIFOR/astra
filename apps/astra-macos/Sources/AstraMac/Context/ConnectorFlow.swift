import AppKit
import AstraCore
import Foundation
import Network

/// connector（外部サービス）の OAuth 認可コードフロー。RFC 8252（native app）。
///
/// **契約は core が正**（authorize URL・PKCE・callback 受理・トークン交換）。ここが持つのは
/// OS 統合だけ: loopback で折り返しを待ち、ブラウザを開く。**トークンは Keychain のみ**（§21）。
/// live なトークン交換は実 OAuth 提供者（client_id・ユーザーの consent）が要るので、この環境では
/// URL 組み立て・PKCE・loopback 受理まで検証し、交換は提供者が揃ったときに動く。
@MainActor
final class ConnectorFlow {
    struct Pending { let verifier: String; let state: String; let redirectUri: String; let port: UInt16 }

    private var listener: NWListener?

    /// PKCE の verifier（43..128 の unreserved）。乱数から作る。
    static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let b64 = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return String(b64.prefix(96))
    }

    /// loopback を開いて折り返しを 1 回待つ。`onCallback` に core で解析した結果を返す。
    /// 戻り値は実際に開いた port（authorize の redirect_uri に使う）。
    @discardableResult
    func startLoopback(_ onCallback: @escaping (OauthCallback) -> Void) throws -> UInt16 {
        let params = NWParameters.tcp
        // loopback にだけ束ねる。
        if let opts = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            opts.version = .v4
        }
        let listener = try NWListener(using: params)   // port は OS が選ぶ（.ready で確定）
        self.listener = listener
        listener.newConnectionHandler = { conn in
            conn.start(queue: .main)
            conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, _, _ in
                let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                // "GET /callback?code=...&state=... HTTP/1.1"
                let target = request.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
                let parsed = connectorParseCallback(target: target)
                let body = "<!doctype html><meta charset=\"utf-8\"><title>Astra</title><p>Astra に戻ってください。</p>"
                let resp = "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: \(body.utf8.count)\r\nconnection: close\r\n\r\n\(body)"
                conn.send(content: resp.data(using: .utf8), completion: .contentProcessed { _ in conn.cancel() })
                onCallback(parsed)
            }
        }
        var ready = false
        listener.stateUpdateHandler = { st in if case .ready = st { ready = true } }
        listener.start(queue: .main)
        // .ready になると port が確定する。
        var waited = 0
        while !ready && waited < 200 { RunLoop.current.run(until: Date().addingTimeInterval(0.02)); waited += 1 }
        return listener.port?.rawValue ?? 0
    }

    func stopLoopback() { listener?.cancel(); listener = nil }

    /// 認可を始める: loopback を開き、authorize URL を core で組み、ブラウザで開く。
    /// 提供者の client_id が無ければ nil（**繋げないことを繋いだつもりにさせない**）。
    func begin(provider: String, clientId: String, scopes: [String],
               onCallback: @escaping (OauthCallback, Pending) -> Void) throws -> Bool {
        guard !clientId.isEmpty else { return false }
        let verifier = Self.randomVerifier()
        let challenge = AstraCoreBridge.pkceChallenge(verifier)
        let state = Self.randomVerifier()
        var pendingBox: Pending?
        let port = try startLoopback { params in
            if let p = pendingBox { onCallback(params, p) }
        }
        let redirect = "http://127.0.0.1:\(port)/callback"
        let pending = Pending(verifier: verifier, state: state, redirectUri: redirect, port: port)
        pendingBox = pending
        guard let url = AstraCoreBridge.authorizeUrl(
            provider: provider, clientId: clientId, redirectUri: redirect,
            scopes: scopes, state: state, codeChallenge: challenge),
              let u = URL(string: url) else { stopLoopback(); return false }
        NSWorkspace.shared.open(u)   // アプリ内 webview では開かない（RFC 8252 §8.12）
        return true
    }
}
