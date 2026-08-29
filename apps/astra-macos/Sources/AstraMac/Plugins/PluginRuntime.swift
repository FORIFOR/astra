import Foundation

/// §27 Plugin。manifest を読み、**許した権限の範囲でしか道具を呼ばせない。**
///
/// Plugin が「できること」を宣言しても、それだけでは呼べない。
/// 呼べるのは、その plugin にその権限が許されているときだけ。
/// 許諾は `plugin_permissions`（§24）に残り、次の起動でも効く。
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

    var runsLocallyOnly: Bool { executionSurfaces == ["local"] }

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
            tools: lists["jobs"] ?? []
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
