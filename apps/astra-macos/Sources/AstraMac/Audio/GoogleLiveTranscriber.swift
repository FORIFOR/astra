import Foundation

/// One source, one streaming recognizer. No recording upload or batch finalization.
@MainActor
final class GoogleLiveTranscriber {
    private let network = URLSession(configuration: .ephemeral)
    private var socket: URLSessionWebSocketTask?
    private var sender: Task<Void, Never>?
    private var receiver: Task<Void, Never>?
    private var suspension: Task<Void, Never>?
    private var paused = false
    private var pending = Data()
    private var accepting = true
    private var finishing = false
    private var finished = false
    private var failed = false
    private var sentBytes = 0
    private var openedAt = Date()
    private let base: String
    private let token: String
    var onTranscript: ((String, Bool) -> Void)?
    var onFailure: ((String) -> Void)?
    private(set) var partials = 0
    private(set) var finals = 0

    init(base: String, token: String) {
        self.base = base; self.token = token
    }

    func start() throws {
        guard RecordingRuntime.cloudTranscriptionAllowed else { throw Failure() }
        guard var url = URLComponents(string: base),
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "")) else { throw Failure() }
        url.scheme = url.scheme == "https" ? "wss" : "ws"
        url.path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/transcription/live"
        if !url.path.hasPrefix("/") { url.path = "/" + url.path }
        guard let address = url.url else { throw Failure() }
        var request = URLRequest(url: address)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let ws = network.webSocketTask(with: request)
        socket = ws; openedAt = Date(); finished = false; sentBytes = 0
        ws.resume()
        receiver = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await ws.receive()
                    guard let self, !self.failed, self.socket === ws else { return }
                    let data: Data
                    switch message { case .data(let d): data = d; case .string(let s): data = Data(s.utf8); @unknown default: continue }
                    let response = try JSONDecoder().decode(Response.self, from: data)
                    if response.type == "error" { throw Failure() }
                    if response.type == "finished" { self.finished = true; return }
                    for row in response.results ?? [] where !row.text.isEmpty {
                        if row.isFinal { self.finals += 1 } else { self.partials += 1 }
                        self.onTranscript?(row.text, row.isFinal)
                    }
                }
            } catch { if !Task.isCancelled { self?.fail() } }
        }
    }

    func append(_ samples: [Float]) {
        guard accepting, !paused, !failed else { return }
        guard RecordingRuntime.cloudTranscriptionAllowed else { fail(); return }
        var pcm = Data(capacity: samples.count * 2)
        for sample in samples {
            let value = Int16(max(-32768, min(32767, Int(sample.isFinite ? sample * 32767 : 0))))
            let bits = UInt16(bitPattern: value)
            pcm.append(UInt8(bits & 255)); pcm.append(UInt8(bits >> 8))
        }
        pending.append(pcm)
        // Bound latency and memory during a stalled network; never silently lose audio.
        guard pending.count <= 320_000 else { fail(); return }
        pump()
    }

    private func pump() {
        guard sender == nil, !failed else { return }
        let priorSuspension = suspension
        sender = Task { [weak self] in
            guard let self else { return }
            defer { self.sender = nil }
            do {
                await priorSuspension?.value
                if self.socket == nil && !self.failed { try self.start() }
                while !self.pending.isEmpty {
                    guard RecordingRuntime.cloudTranscriptionAllowed else { throw Failure() }
                    // Rotate before Google's five-minute limit, including long pauses.
                    if self.sentBytes >= 7_680_000 || Date().timeIntervalSince(self.openedAt) >= 240 {
                        try await self.drain()
                        self.receiver?.cancel()
                        self.socket?.cancel(with: .normalClosure, reason: nil)
                        try self.start()
                    }
                    guard let ws = self.socket else { throw Failure() }
                    let count = min(6_400, self.pending.count)
                    let bytes = self.pending.prefix(count)
                    self.pending.removeFirst(count)
                    try await ws.send(.data(Data(bytes)))
                    self.sentBytes += count
                }
            } catch { self.fail() }
        }
    }

    private func drain() async throws {
        guard let ws = socket, !failed else { throw Failure() }
        try await ws.send(.string("{\"type\":\"finish\"}"))
        let deadline = Date().addingTimeInterval(8)
        while !finished && !failed && Date() < deadline {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        guard finished else { throw Failure() }
    }

    func setPaused(_ value: Bool) {
        guard paused != value, !finishing, !failed else { return }
        paused = value
        if value {
            let activeSender = sender
            let priorSuspension = suspension
            suspension = Task {
                await priorSuspension?.value
                await activeSender?.value
                if self.socket != nil && !self.failed {
                    do { try await self.drain() } catch { self.fail() }
                }
                self.receiver?.cancel()
                self.socket?.cancel(with: .normalClosure, reason: nil)
                self.socket = nil
            }
        } else { pump() }
    }

    func cancel() {
        accepting = false; failed = true
        sender?.cancel(); receiver?.cancel(); suspension?.cancel()
        pending.removeAll()
        socket?.cancel(with: .goingAway, reason: nil)
        network.invalidateAndCancel()
    }

    func finish() async {
        guard !finishing else { return }
        accepting = false; finishing = true
        await suspension?.value
        await sender?.value
        if !failed, socket != nil { do { try await drain() } catch { fail() } }
        receiver?.cancel()
        socket?.cancel(with: .normalClosure, reason: nil)
        network.invalidateAndCancel()
    }

    private func fail() {
        guard !failed else { return }
        failed = true; accepting = false; pending.removeAll()
        socket?.cancel(with: .goingAway, reason: nil)
        onFailure?("Googleのライブ文字起こしに接続できません。録音はこのMacに保存されています。")
    }
    private struct Response: Decodable {
        let type: String
        let results: [Row]?
    }
    private struct Row: Decodable { let text: String; let isFinal: Bool }
    private struct Failure: Error {}
}
