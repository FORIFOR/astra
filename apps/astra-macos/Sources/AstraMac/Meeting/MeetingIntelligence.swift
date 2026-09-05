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
            // 「〜を先に出す」「〜に回しましょう」も決めたこと（REAL_MEETING の台本で 0/2 だった）。
            } else if ["決定", "決めま", "確定", "で行き", "にしま", "先に", "しましょう"].contains(where: t.contains) {
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

    /// 拾い間違いを人が直す。**AI の結果を直せないと、出所を見せる意味が薄い。**
    /// 確かめられて、違っていたら直せて、初めて「検証できる」と言える。
    func edit(_ item: CanvasItem, to text: String) {
        canvas = Self.replace(canvas, id: item.id, with: text)
        AstraStateStore.shared.updateCanvas(canvas)
    }

    /// 直前に消したもの。**戻せるようにするため**に持つ。
    ///
    /// 実装を知らない評価者が「これは違う」を押し、メモが確認も取り消しも無く
    /// 消えた。隣は「直す」で、間違えて押しやすい位置に在る。
    /// 確認ダイアログで止めるのではなく、**戻せる**ようにする
    /// （§6 間違いを見つけた場所で直せる）。
    @Published private(set) var lastRemoved: CanvasItem?
    /// 消したものが**どの束に居たか**。戻すときに要る。
    private var lastRemovedGroup: WritableKeyPath<MeetingCanvas, [CanvasItem]>?

    /// 拾い間違いを消す。直前の 1 件は戻せる。
    func remove(_ item: CanvasItem) {
        let groups: [WritableKeyPath<MeetingCanvas, [CanvasItem]>] =
            [\.decisions, \.actions, \.questions, \.concerns, \.notes]
        lastRemovedGroup = groups.first { canvas[keyPath: $0].contains { $0.id == item.id } }
        lastRemoved = item
        canvas = Self.replace(canvas, id: item.id, with: nil)
        AstraStateStore.shared.updateCanvas(canvas)
    }

    /// 消したものを戻す。**出所（誰・いつ）も、居た束も、そのまま戻す。**
    ///
    /// 拾い直し（`ingest`）を通すと分類からやり直され、別の項目として入る。
    /// 実際それで時刻と話者が失われた（J09 が捕まえた）。元の場所へ戻す。
    func undoRemove() {
        guard let item = lastRemoved, let group = lastRemovedGroup else { return }
        lastRemoved = nil
        lastRemovedGroup = nil
        var next = canvas
        next[keyPath: group].append(item)
        next[keyPath: group].sort { ($0.at ?? 0) < ($1.at ?? 0) }
        canvas = next
        AstraStateStore.shared.updateCanvas(canvas)
    }

    /// 出所（いつ・誰が）は保つ。**直したのは文言だけ**で、誰の発言かは変えない。
    static func replace(_ base: MeetingCanvas, id: UUID, with text: String?) -> MeetingCanvas {
        func apply(_ xs: [CanvasItem]) -> [CanvasItem] {
            xs.compactMap { item in
                guard item.id == id else { return item }
                guard let text else { return nil }
                return CanvasItem(text, at: item.at, speaker: item.speaker)
            }
        }
        var out = base
        out.decisions = apply(out.decisions)
        out.actions = apply(out.actions)
        out.questions = apply(out.questions)
        out.concerns = apply(out.concerns)
        out.notes = apply(out.notes)
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
