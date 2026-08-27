import Foundation
import AstraCore

/// サインインの資格情報の置き場。**refresh token と device token は Keychain のみ**。
/// access token はメモリだけ（寿命 15 分、実装仕様 §4.2）。正本 §21 / device-boundary。
enum SessionStore {
    private static let refreshKey = "astra.refresh_token"
    private static let deviceKey = "astra.device_token"

    /// サインイン結果を保管する。**access token はディスクに書かない。**
    static func persist(_ tokens: Tokens) throws {
        try KeychainStore.set(refreshKey, tokens.refreshToken)
        try KeychainStore.set(deviceKey, tokens.deviceToken)
    }

    static func refreshToken() throws -> String? { try KeychainStore.get(refreshKey) }
    static func deviceToken() throws -> String? { try KeychainStore.get(deviceKey) }

    /// サインアウト。冪等（無くても成功）。
    static func clear() throws {
        try KeychainStore.delete(refreshKey)
        try KeychainStore.delete(deviceKey)
    }
}
