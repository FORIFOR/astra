import Foundation

/// One submitted job per meeting/action/transcript snapshot. Polling an existing
/// job after a timeout does not submit a second paid generation.
@MainActor
final class MeetingAIRequests {
    struct Key: Hashable {
        let scope: String
        let meeting: String
        let action: String
        let transcript: String
    }
    struct TerminalJobFailure: LocalizedError {
        var errorDescription: String? { "AIの処理が終了し、回答を取得できませんでした。再試行すると新しく実行します。" }
    }
    struct Submission: Sendable {
        let answer: String
        let taskId: String
    }
    private var answers: [Key: String] = [:]
    private var jobs: [Key: String] = [:]
    private var order: [Key] = []
    private var busy = false

    func run(_ key: Key,
             submit: () async throws -> Submission,
             poll: (String) async throws -> String) async throws -> String {
        guard !key.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw TranslationFailure(message: "発言が文字起こしされてから実行してください。")
        }
        if let answer = answers[key] { return answer }
        guard !busy else { throw TranslationFailure(message: "現在のAI操作が終わるまでお待ちください。") }
        busy = true
        defer { busy = false }
        var answer = ""
        if jobs[key] == nil {
            let result = try await submit()
            answer = result.answer
            if !result.taskId.isEmpty { jobs[key] = result.taskId }
            if !order.contains(key) { order.append(key) }
            // Bound in-memory snapshots; no transcript is written to a cache file.
            while order.count > 16 {
                let old = order.removeFirst(); answers.removeValue(forKey: old); jobs.removeValue(forKey: old)
            }
        }
        if answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let job = jobs[key] {
            do { answer = try await poll(job) }
            catch let error as TerminalJobFailure { jobs.removeValue(forKey: key); throw error }
        }
        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw TranslationFailure(message: "AIの回答を取得できませんでした。")
        }
        answers[key] = answer
        jobs.removeValue(forKey: key)
        return answer
    }
}
