import Foundation

/// §27 Plugin。manifest を読み、**許した権限の範囲でしか道具を呼ばせない。**
///
/// Plugin が「できること」を宣言しても、それだけでは呼べない。
/// 呼べるのは、その plugin にその権限が許されているときだけ。
/// 許諾は `plugin_permissions`（§24）に残り、次の起動でも効く。
/// manifest の接続 1 つ（同意画面 1 回）。`grants` が全部 `.read` なら「読むだけ」の接続。
struct ConnectorDecl: Equatable {
    let id: String
    let provider: String
    let grants: [String]
    let scopes: [String]
    let purpose: String?
    var readOnly: Bool { !grants.isEmpty && grants.allSatisfy { $0.hasSuffix(".read") } }
}

struct PluginManifest: Equatable {
    let id: String
    let name: String
    let version: String
    let publisher: String
    let verified: Bool
    /// 端末で走るか cloud か。資格情報が端末にしか無いものは local だけにする。
    let executionSurfaces: [String]
    let permissions: [String]
    let tools: [String]
    /// 外部サービスへの接続（capability 単位）。無い plugin は空。
    var connectors: [ConnectorDecl] = []

    var runsLocallyOnly: Bool { executionSurfaces == ["local"] }
    /// Work Context が使う「読むだけ」の接続。無ければ nil。
    var readConnector: ConnectorDecl? { connectors.first { $0.readOnly } }

    /// `connectors:` の塊だけを読む（`- id:` で始まる map の並び。中の `grants:` / `scopes:` は list）。
    static func parseConnectors(_ yaml: String) -> [ConnectorDecl] {
        var out: [ConnectorDecl] = []
        var inBlock = false
        var cur: [String: String] = [:]
        var lists: [String: [String]] = [:]
        var listKey: String?
        func flush() {
            if let id = cur["id"], let provider = cur["provider"] {
                out.append(ConnectorDecl(id: id, provider: provider,
                                         grants: lists["grants"] ?? [], scopes: lists["scopes"] ?? [],
                                         purpose: cur["purpose"]))
            }
            cur = [:]; lists = [:]; listKey = nil
        }
        for rawLine in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let indented = line.hasPrefix(" ")
            if !indented {
                if inBlock { flush(); inBlock = false }
                if trimmed == "connectors:" { inBlock = true }
                continue
            }
            guard inBlock else { continue }
            if trimmed.hasPrefix("- ") {
                let rest = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
                if let colon = rest.firstIndex(of: ":"), rest.hasPrefix("id") {
                    flush()
                    cur["id"] = String(rest[rest.index(after: colon)...]).trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
                } else if let key = listKey {
                    lists[key, default: []].append(rest.trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")))
                }
                continue
            }
            guard let colon = trimmed.firstIndex(of: ":") else { continue }
            let key = String(trimmed[trimmed.startIndex..<colon])
            let value = String(trimmed[trimmed.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if value.isEmpty { listKey = key; lists[key] = [] }
            else { listKey = nil; cur[key] = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'")) }
        }
        if inBlock { flush() }
        return out
    }

    /// plugin.yaml のうち、実行に要る項目だけを読む（YAML 全体の実装はしない）。
    /// 読めない・欠けている項目は**推測で埋めない**。
    static func parse(_ yaml: String) -> PluginManifest? {
        var scalars: [String: String] = [:]
        var lists: [String: [String]] = [:]
        var currentList: String?
        for rawLine in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("#") { continue }
            let indented = line.hasPrefix(" ") || line.hasPrefix("\t")
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            if trimmed.hasPrefix("- ") {
                if let key = currentList {
                    lists[key, default: []].append(String(trimmed.dropFirst(2))
                        .trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")))
                }
                continue
            }
            guard !indented, let colon = trimmed.firstIndex(of: ":") else { continue }
            let key = String(trimmed[trimmed.startIndex..<colon])
            let value = String(trimmed[trimmed.index(after: colon)...])
                .trimmingCharacters(in: .whitespaces)
            if value.isEmpty {
                currentList = key
                lists[key] = []
            } else if value.hasPrefix("[") {
                currentList = nil
                lists[key] = value.dropFirst().dropLast()
                    .split(separator: ",")
                    .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")) }
                    .filter { !$0.isEmpty }
            } else {
                currentList = nil
                scalars[key] = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            }
        }
        guard let id = scalars["id"], let name = scalars["name"],
              let version = scalars["version"], let publisher = scalars["publisher"]
        else { return nil }
        return PluginManifest(
            id: id, name: name, version: version, publisher: publisher,
            verified: scalars["verified"] == "true",
            executionSurfaces: lists["execution_surfaces"] ?? [],
            permissions: lists["permissions"] ?? [],
            tools: lists["jobs"] ?? [],
            connectors: parseConnectors(yaml)
        )
    }
}

@MainActor
final class PluginRuntime {
    static let shared = PluginRuntime()

    private(set) var installed: [PluginManifest] = []
    /// 許諾の記憶。plugin id → 許した権限。
    private var granted: [String: Set<String>] = [:]

    /// `plugins/builtin/*/plugin.yaml` を読む。読めなかったものは黙って飛ばさず数える。
    @discardableResult
    func load(from root: String) -> (loaded: Int, skipped: Int) {
        installed.removeAll()
        var skipped = 0
        let fm = FileManager.default
        guard let dirs = try? fm.contentsOfDirectory(atPath: root) else { return (0, 0) }
        for dir in dirs.sorted() {
            let path = root + "/" + dir + "/plugin.yaml"
            guard fm.fileExists(atPath: path),
                  let text = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
            if let manifest = PluginManifest.parse(text) {
                installed.append(manifest)
            } else {
                skipped += 1
            }
        }
        return (installed.count, skipped)
    }

    /// その plugin にその権限を許す。§24 に残す。
    func grant(_ pluginId: String, _ permission: String) {
        granted[pluginId, default: []].insert(permission)
        LocalStore.shared.exec("""
        INSERT OR REPLACE INTO plugin_permissions (plugin,capability,granted,decided_at)
        VALUES ('\(pluginId)','\(permission)',1,\(Date().timeIntervalSince1970))
        """)
    }

    func revoke(_ pluginId: String, _ permission: String) {
        granted[pluginId]?.remove(permission)
        LocalStore.shared.exec("""
        INSERT OR REPLACE INTO plugin_permissions (plugin,capability,granted,decided_at)
        VALUES ('\(pluginId)','\(permission)',0,\(Date().timeIntervalSince1970))
        """)
    }

    /// 呼んでよいか。**manifest に書いてあるだけでは通さない**（許諾が要る）。
    func mayCall(_ pluginId: String, permission: String) -> Bool {
        guard let manifest = installed.first(where: { $0.id == pluginId }) else { return false }
        guard manifest.permissions.contains(permission) else { return false }
        return granted[pluginId]?.contains(permission) == true
    }

    func reset() {
        installed.removeAll()
        granted.removeAll()
    }
}
