import Foundation

/// Google final-pass results are stored separately: live citations must remain immutable.
struct CloudTranscriptRow: Codable {
    let text: String
    let start_ms: Int
    let end_ms: Int
    let speaker_tag: Int?
}

@MainActor
enum CloudMeetingTranscription {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func setPending(_ pending: Bool, id: String) {
        let url = resultURL(id: id).deletingLastPathComponent().appendingPathComponent("google-pending")
        if pending { try? Data().write(to: url, options: .atomic) }
        else { try? FileManager.default.removeItem(at: url) }
    }
    static func hasPending(id: String) -> Bool {
        FileManager.default.fileExists(atPath: resultURL(id: id).deletingLastPathComponent().appendingPathComponent("google-pending").path)
    }

    static func saveFailure(_ message: String?, id: String) {
        let url = resultURL(id: id).deletingLastPathComponent().appendingPathComponent("google-error.txt")
        if let message { try? Data(message.utf8).write(to: url, options: .atomic) }
        else { try? FileManager.default.removeItem(at: url) }
    }
    static func savedFailure(id: String) -> String? {
        try? String(contentsOf: resultURL(id: id).deletingLastPathComponent().appendingPathComponent("google-error.txt"), encoding: .utf8)
    }

    static func savedRows(id: String) -> [CloudTranscriptRow] {
        guard let data = try? Data(contentsOf: resultURL(id: id)) else { return [] }
        return (try? JSONDecoder().decode([CloudTranscriptRow].self, from: data)) ?? []
    }

    private static func resultURL(id: String) -> URL {
        LocalStore.dataRoot.appendingPathComponent("meetings").appendingPathComponent(id)
            .appendingPathComponent("google-final.json")
    }

    static func finalize(base: String, token: String, localId: String, root: String) async throws {
        func consent() throws {
            guard RecordingRuntime.cloudTranscriptionAllowed else {
                throw Failure(message: "クラウド文字起こしの送信を停止しました。録音はこのMacに保存されています。")
            }
        }
        try consent()
        guard var components = URLComponents(string: base),
              components.scheme == "https" || (components.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(components.host ?? "")) else {
            throw Failure(message: "文字起こしサーバーにはHTTPS接続が必要です。")
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 1_800
        let network = URLSession(configuration: config)
        defer { network.invalidateAndCancel() }
        let cleanBase = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        func request(_ path: String, body: [String: Any]? = nil) async throws -> Data {
            try consent()
            guard let url = URL(string: cleanBase + path) else { throw Failure(message: "文字起こしサーバーの設定を確認してください。") }
            var req = URLRequest(url: url)
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let body {
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, response) = try await network.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw Failure(message: "クラウド文字起こしに接続できません。録音はこのMacに保存されています。")
            }
            return data
        }
        struct Job: Codable { let base: String; let meetingId: String; let taskId: String }
        let jobURL = resultURL(id: localId).deletingLastPathComponent().appendingPathComponent("google-job.json")
        let job: Job
        if let data = try? Data(contentsOf: jobURL), let existing = try? JSONDecoder().decode(Job.self, from: data), existing.base == cleanBase {
            job = existing // Resume polling after a disconnect or app restart; do not upload again.
        } else {
            struct Created: Decodable { let id: String }
            let created = try JSONDecoder().decode(Created.self, from: await request("/v1/meetings", body: [
                "title": "会議", "language": "ja-JP", "consent_confirmed": true,
                "audio_sources": ["microphone", "system"]
            ]))
            components.scheme = components.scheme == "https" ? "wss" : "ws"
            components.path = "/" + [components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")), "v1/meetings/\(created.id)/audio"].filter { !$0.isEmpty }.joined(separator: "/")
            guard let url = components.url else { throw Failure(message: "文字起こしサーバーの設定が無効です。") }
            var upload = URLRequest(url: url)
            upload.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let socket = network.webSocketTask(with: upload)
            socket.resume()
            defer { socket.cancel(with: .normalClosure, reason: nil) }
            let folder = URL(fileURLWithPath: root).appendingPathComponent(localId).appendingPathComponent("mic")
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "pcm" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
            var bytes = 0
            for file in files {
                try consent()
                let data = try await Task.detached { try Data(contentsOf: file) }.value
                // Keep WebSocket messages bounded even for recovered long fragments.
                for offset in stride(from: 0, to: data.count, by: 32_000) {
                    try consent()
                    try await socket.send(.data(data.subdata(in: offset..<min(offset + 32_000, data.count))))
                }
                bytes += data.count
            }
            guard bytes > 0 else { throw Failure(message: "録音音声がありません。マイクの入力を確認してください。") }
            try await socket.send(.string("{\"type\":\"flush\"}"))
            // A network write alone is not proof of persistence. Wait for the server's ordered flush.
            let ack = try await socket.receive()
            let ackData: Data
            switch ack {
            case .data(let data): ackData = data
            case .string(let text): ackData = Data(text.utf8)
            @unknown default: throw Failure(message: "音声の保存確認ができませんでした。")
            }
            struct Ack: Decodable { let type: String; let bytes: Int }
            let receipt = try JSONDecoder().decode(Ack.self, from: ackData)
            guard receipt.type == "flushed", receipt.bytes == bytes else { throw Failure(message: "音声を最後まで送信できませんでした。") }
            socket.cancel(with: .normalClosure, reason: nil)
            struct Started: Decodable { let task_id: String }
            let started = try JSONDecoder().decode(Started.self, from: await request("/v1/meetings/\(created.id)/finish", body: [:]))
            job = Job(base: cleanBase, meetingId: created.id, taskId: started.task_id)
            try JSONEncoder().encode(job).write(to: jobURL, options: .atomic)
        }
        struct Status: Decodable { let status: String }
        struct Rows: Decodable { let items: [CloudTranscriptRow] }
        let deadline = Date().addingTimeInterval(1_800)
        while Date() < deadline {
            let rows = try JSONDecoder().decode(Rows.self, from: await request("/v1/meetings/\(job.meetingId)/segments?pass=final")).items
            if !rows.isEmpty {
                saveFailure(nil, id: localId)
                try JSONEncoder().encode(rows).write(to: resultURL(id: localId), options: .atomic)
                AstraCoreBridge.markUploaded(root: root, meetingId: localId)
                try? FileManager.default.removeItem(at: jobURL)
                return
            }
            let state = try JSONDecoder().decode(Status.self, from: await request("/v1/tasks/\(job.taskId)"))
            if ["COMPLETED", "SUCCEEDED", "FAILED", "CANCELED", "CANCELLED"].contains(state.status) {
                try? FileManager.default.removeItem(at: jobURL)
                throw Failure(message: "確定した文字起こしを取得できませんでした。録音はこのMacに保存されています。")
            }
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
        throw Failure(message: "文字起こしの待ち時間を超えました。録音はこのMacに保存されています。")
    }
}
