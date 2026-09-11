import Foundation
import AstraCore

extension SelfTest {
    @MainActor static func sessionRenewal() async {
        let base = "http://127.0.0.1:3000"
        let identity = "session-renewal-\(UUID().uuidString.lowercased())"
        let key = "astra.gateway.session.\(base).\(identity)"
        defer { try? KeychainStore.delete(key) }
        var now = Date()
        do {
            let session = GatewaySession.desktop(base: base, identity: identity, now: { now })
            let first = try await session.tokens()
            let me = try await Task.detached { try AstraCoreBridge.me(base, accessToken: first.accessToken) }.value
            now = now.addingTimeInterval(901)
            let renewed = try await withThrowingTaskGroup(of: String.self) { group in
                for _ in 0..<8 { group.addTask { try await session.tokens().accessToken } }
                var out: [String] = []; for try await token in group { out.append(token) }; return out
            }
            guard Set(renewed).count == 1, renewed[0] != first.accessToken else { throw GatewaySession.SessionError.invalidResponse }
            let again = GatewaySession.desktop(base: base, identity: identity)
            let restored = try await again.tokens()
            let after = try await Task.detached { try AstraCoreBridge.me(base, accessToken: restored.accessToken) }.value
            guard me.userId == after.userId, me.tenantId == after.tenantId,
                  first.deviceToken != "", restored.deviceToken != "" else { throw GatewaySession.SessionError.invalidResponse }
            try KeychainStore.delete(key)
            print("SELFTEST_OK session-renewal: real gateway rotation, 8 concurrent callers, Keychain reload, same user and tenant, credentials cleaned up")
            exit(0)
        } catch {
            try? KeychainStore.delete(key)
            print("SELFTEST_FAIL session-renewal: \(error)"); exit(2)
        }
    }
}
