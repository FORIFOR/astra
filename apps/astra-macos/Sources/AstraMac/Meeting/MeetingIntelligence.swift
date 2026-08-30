import Foundation

/// §20 会議中の抽出。**全 Transcript を毎回 LLM に再投入しない。**
///
/// ```text
/// PreviousState + RecentTranscript → Delta
/// ```
///
/// 毎回全文を投げると、会議が長くなるほど遅く・高く・不安定になる。
/// ここは「前回どこまで読んだか」を持ち、新しい分だけを渡す係。
/// 抽出そのもの（LLM 呼び出し）は差し替え可能にしてあり、
/// 手元だけで動く既定の抽出器も持つ（gateway が無くても会議が成立するように）。
@MainActor
final class MeetingIntelligence {
    static let shared = MeetingIntelligence()

    /// どこまで取り込んだか。行数で持つ（transcript は追記のみ）。
    private(set) var consumedLines = 0
    private(set) var canvas = MeetingCanvas()
    /// 何回抽出を回したか。全文再投入していないことの証拠に使う。
    private(set) var passes = 0
    /// 直近の抽出に渡した行数。
    private(set) var lastBatchSize = 0

    /// §20 5〜15 秒ごと。ここでは行数がたまったら回す。
    static let batchThreshold = 3

    func reset() {
        consumedLines = 0
        canvas = MeetingCanvas()
        passes = 0
        lastBatchSize = 0
    }

    /// 新しい行だけを取り出して抽出する。新しい行が無ければ何もしない。
    /// 戻り値は「抽出を回したか」。
    @discardableResult
    func ingest(_ lines: [String], force: Bool = false) -> Bool {
        ingest(lines.map { CanvasItem($0) }, force: force)
    }

    /// 出所つきで取り込む。話者と時刻を持ったまま Canvas に載せる
    /// —— 「決まったこと」から発言に戻れないと、拾い間違いを直せない。
    @discardableResult
    func ingest(_ lines: [CanvasItem], force: Bool = false) -> Bool {
        guard consumedLines <= lines.count else { reset(); return false }
        let fresh = Array(lines[consumedLines...])
        guard !fresh.isEmpty, force || fresh.count >= Self.batchThreshold else { return false }
        lastBatchSize = fresh.count
        consumedLines = lines.count
        passes += 1
        canvas = Self.merge(canvas, delta: Self.extract(fresh))
        AstraStateStore.shared.updateCanvas(canvas)
        AstraEventBus.shared.publish(.meetingTranscriptUpdated(lines: consumedLines))
        return true
    }

    /// 手元だけの抽出。**言い切りの推測はしない**——語をそのまま拾って分類するだけ。
    /// gateway がある場合はここを差し替える（`AgentTask` 経由）。
    static func extract(_ lines: [String]) -> MeetingCanvas {
        extract(lines.map { CanvasItem($0) })
    }

    static func extract(_ lines: [CanvasItem]) -> MeetingCanvas {
        var out = MeetingCanvas()
        for line in lines {
            let trimmed = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            // 分類は本文で見るが、Canvas に載せるのは**出所を持ったまま**の行。
            let t = trimmed
            let item = CanvasItem(trimmed, at: line.at, speaker: line.speaker)
            if t.contains("？") || t.contains("?") {
                out.questions.append(item)
            } else if ["決定", "決めま", "確定", "で行き", "にしま"].contains(where: t.contains) {
                out.decisions.append(item)
            } else if ["まで", "お願い", "対応し", "送り", "作成し", "担当"].contains(where: t.contains) {
                out.actions.append(item)
            } else if ["懸念", "心配", "リスク", "気になる", "難し"].contains(where: t.contains) {
                out.concerns.append(item)
            } else {
                out.notes.append(item)
            }
        }
        return out
    }

    /// 前の状態に差分を足す。作り直さない（§20 Incremental）。
    static func merge(_ base: MeetingCanvas, delta: MeetingCanvas) -> MeetingCanvas {
        var out = base
        out.decisions += delta.decisions
        out.actions += delta.actions
        out.questions += delta.questions
        out.concerns += delta.concerns
        out.notes += delta.notes
        return out
    }
}
