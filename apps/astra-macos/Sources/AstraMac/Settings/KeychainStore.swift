import Foundation
import Security

/// 資格情報の保管（macOS Keychain）。正本 §21「Desktop: Keychain / Credential Manager」。
///
/// **refresh token はここだけに置く。**localStorage にも Cloud/DB にも出さない（XSS・平文残留を避ける）。
/// アクセストークンは置かない（寿命 15 分でメモリにだけ持つ、実装仕様 §4.2）。
/// Tauri 側 `secrets.rs`（keyring, service=com.astra.desktop）と同じ契約を native に用意する。
enum KeychainStore {
    /// サービス名。他アプリの項目と混ざらないよう bundle id に揃える（このアプリは com.astra.mac）。
    static let service = "com.astra.mac"

    enum KeychainError: Error, CustomStringConvertible {
        case unexpected(OSStatus)
        var description: String {
            switch self {
            case .unexpected(let status):
                let msg = SecCopyErrorMessageString(status, nil) as String? ?? "unknown"
                return "keychain error \(status): \(msg)"
            }
        }
    }

    private static func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    /// 保存する。既存は上書き（upsert）。
    static func set(_ key: String, _ value: String) throws {
        let data = Data(value.utf8)
        SecItemDelete(query(key) as CFDictionary) // 既存を消してから足す（冪等 upsert）
        var add = query(key)
        add[kSecValueData as String] = data
        // この端末でのみ、ロック解除後に読める。iCloud Keychain には同期しない。
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpected(status) }
    }

    /// 読み出す。**未登録は nil であってエラーではない**（初回起動を「壊れている」と扱わない）。
    static func get(_ key: String) throws -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        switch status {
        case errSecSuccess:
            guard let data = out as? Data, let s = String(data: data, encoding: .utf8) else { return nil }
            return s
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.unexpected(status)
        }
    }

    /// 消す。無いものを消しても成功扱い（サインアウトを冪等にする）。
    static func delete(_ key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpected(status)
        }
    }
}
