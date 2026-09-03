import SwiftUI

/// 会議 1 件の中身。Home の Session Card と、結果面の「メモを開く」から開く。
///
/// 面は `MeetingArtifactView` の 1 つだけ（標本と実データで別の面を持たない）。
/// 中身は**開いた id のもの**を保存から読む。以前は「いまの録音」の値を
/// 出していたので、古い会議を開くと直近の録音の中身が出ていた。
struct SessionDetailView: View {
    let session: MeetingSession
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var recording = RecordingWorkspaceState.shared

    /// この会議がいま録っている／読み取っている最中か。そのときだけ生の値を出す。
    private var isCurrent: Bool {
        recording.currentMeetingId == session.id
            && (session.status == .recording || session.status == .processing)
    }

    var body: some View {
        let transcript = isCurrent
            ? recording.transcript.filter { !$0.interim }
            : LocalStore.shared.loadTranscript(meetingId: session.id)
        let canvas = isCurrent ? store.state.meeting.canvas : LocalStore.shared.loadNotes(meetingId: session.id)
        let cites = SessionCitations(canvas: canvas, transcript: transcript, summary: session.summary)
        MeetingArtifactView(
            title: session.title,
            duration: session.timeLabel(),
            participants: session.participantCount,
            onBack: { MainNav.shared.openSession = nil },
            summary: cites.summary,
            decisions: cites.decisions,
            actionItems: cites.actions,
            questions: cites.questions,
            concerns: cites.concerns,
            notes: cites.notes,
            transcript: cites.transcript,
            hasAudio: false)
        .accessibilityIdentifier("sessionDetail")
    }
}

/// 拾ったものに引用番号を振り、文字起こしの行へ結ぶ。
///
/// 番号は 決まったこと → やること → 質問 → 懸念 → メモ の順。文字起こしの行は
/// 「誰が・いつ」が一致する引用の番号を持つ（`MeetingArtifactView.isShown` と同じ鍵）。
struct SessionCitations {
    var summary: [MeetingCitation] = []
    var decisions: [MeetingCitation] = []
    var actions: [MeetingCitation] = []
    var questions: [MeetingCitation] = []
    var concerns: [MeetingCitation] = []
    var notes: [MeetingCitation] = []
    var transcript: [MeetingCitation] = []

    init(canvas: MeetingCanvas, transcript rows: [TranscriptSegment], summary text: String?) {
        var n = 0
        func cite(_ item: CanvasItem) -> MeetingCitation {
            n += 1
            return MeetingCitation(number: n, text: item.text,
                                   transcriptTime: item.timeLabel ?? "--:--",
                                   speaker: item.speaker ?? "")
        }
        decisions = canvas.decisions.map(cite)
        actions = canvas.actions.map(cite)
        questions = canvas.questions.map(cite)
        concerns = canvas.concerns.map(cite)
        notes = canvas.notes.map(cite)
        let all = decisions + actions + questions + concerns + notes
        // 要約が拾ったものの 1 件目と同じ文なら、要約としては出さない
        // （同じ文が 2 段続けて出るだけで、要約ではない）。別の文のときだけ出す。
        if let text, !text.isEmpty, !all.contains(where: { $0.text == text }) {
            summary = [MeetingCitation(number: nil, text: text, transcriptTime: "", speaker: "")]
        }
        transcript = rows.map { r in
            let hit = all.first { $0.transcriptTime == r.timeLabel && $0.speaker == r.speaker }
            return MeetingCitation(number: hit?.number, text: r.text,
                                   transcriptTime: r.timeLabel, speaker: r.speaker)
        }
    }
}
