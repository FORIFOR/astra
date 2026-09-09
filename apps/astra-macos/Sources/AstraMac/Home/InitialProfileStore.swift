import AstraCore
import SwiftUI

struct InitialProfileSections: Codable, Equatable {
    var focus: [String]
    var people: [String]
    var priorities: [String]
    var workPattern: [String]
    var openItems: Int
}
struct InitialProfileProgress: Codable, Equatable {
    let source: String
    let status: String
    let artifacts: Int
}
struct InitialProfileResult: Codable, Equatable {
    let id: String
    let provider: String
    let status: String
    let startedAt: String
    let updatedAt: String
    let outcomes: [InitialProfileProgress]
    let sections: InitialProfileSections?
    var finished: Bool { status == "confirmed" }
}

@MainActor
final class InitialProfileStore: ObservableObject {
    static let shared = InitialProfileStore()
    @Published private(set) var result: InitialProfileResult?
    @Published private(set) var failure: String?
    @Published private(set) var saving = false
    @Published private(set) var starting = false
    private var base: String?
    private var token: String?
    private var poll: Task<Void, Never>?
    private var generation = UUID()
    private var requestedProvider: String?
    var visible: Bool { (starting || failure != nil) || (result != nil && result?.finished != true) }

    func configureBackend(base: String, token: String) {
        // Cancel stale responses when the authenticated session changes.
        if self.base != base || self.token != token {
            poll?.cancel(); generation = UUID(); result = nil; failure = nil
            starting = false; saving = false; requestedProvider = nil
        }
        self.base = base; self.token = token
        poll = Task { await refresh(); schedule() }
    }

    func connected(provider: String) {
        guard ["google", "microsoft"].contains(provider) else { return }
        guard result?.finished != true else { return }
        requestedProvider = provider
        starting = true; failure = nil
        MainWindowController.shared.showSection(.home)
        Task {
            do {
                let text = try await call("begin", body: ["provider": provider])
                result = try Self.decode(text); starting = false
                schedule()
            } catch is CancellationError { return } catch { starting = false; failure = "初期解析を開始できませんでした。接続先を確認して再試行してください。" }
        }
    }

    func retry() {
        if result == nil, let requestedProvider { connected(provider: requestedProvider); return }
        failure = nil
        Task {
            do { _ = try await call("retry"); await refresh(); schedule() }
            catch is CancellationError { return }
            catch { failure = "再試行できませんでした。通信を確認してください。" }
        }
    }

    static func valid(_ s: InitialProfileSections) -> Bool {
        let groups = [(s.focus, 5), (s.people, 12), (s.priorities, 5), (s.workPattern, 3)]
        return (0...5000).contains(s.openItems) && groups.allSatisfy { values, limit in
            values.count <= limit && values.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= 200 }
        }
    }

    /// Explicit fixtures only; never used by the connection or restore paths.
    func installForTesting(_ value: InitialProfileResult?) { poll?.cancel(); result = value; failure = nil; starting = false }

    func confirm(_ sections: InitialProfileSections) {
        guard Self.valid(sections) else { failure = "項目数の上限を確認してください。1項目は200文字以内で入力できます。"; return }
        guard !saving else { return }; saving = true; failure = nil
        let current = generation
        Task {
            defer { if current == generation { saving = false } }
            do {
                let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
                let body = String(decoding: try encoder.encode(sections), as: UTF8.self)
                _ = try await call("confirm", json: body)
                await refresh(); WorkContextStore.shared.load()
            } catch is CancellationError { return }
            catch { failure = "確認結果を保存できませんでした。もう一度お試しください。" }
        }
    }

    private func schedule() {
        poll?.cancel()
        guard let result, !result.finished, result.status != "ready", result.status != "failed" else { return }
        poll = Task {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
                await refresh()
                if ["ready", "confirmed", "failed"].contains(self.result?.status ?? "") { return }
            }
        }
    }

    private func refresh() async {
        do { result = try Self.decode(try await call("get")); failure = nil }
        catch is CancellationError { return }
        catch { if visible { failure = "解析状況を取得できません。通信が戻ると再開します。" } }
    }

    private func call(_ operation: String, body: [String: String] = [:], json: String? = nil) async throws -> String {
        guard let base, let token else { throw URLError(.userAuthenticationRequired) }
        let current = generation
        let payload = try json ?? String(decoding: JSONEncoder().encode(body), as: UTF8.self)
        let text: String
        do {
            text = try await Task.detached {
                try apiInitialProfile(baseUrl: base, accessToken: token, operation: operation, bodyJson: payload)
            }.value
        } catch {
            guard current == generation else { throw CancellationError() }
            throw error
        }
        guard current == generation else { throw CancellationError() }
        return text
    }

    static func decode(_ text: String) throws -> InitialProfileResult? {
        struct Response: Decodable { let profile: InitialProfileResult? }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let result = try decoder.decode(Response.self, from: Data(text.utf8)).profile
        if let result {
            guard ["queued", "analysing", "ready", "confirmed", "failed"].contains(result.status),
                  !["ready", "confirmed"].contains(result.status) || result.sections != nil,
                  result.outcomes.allSatisfy({ $0.artifacts >= 0 }),
                  result.sections.map(Self.valid) ?? true else { throw URLError(.cannotParseResponse) }
        }
        return result
    }
}
