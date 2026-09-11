import AppKit
import SwiftUI

/// `--selftest realmeeting <outDir> [simulate] [force] [systemaudio] [seconds=N] [cue=<file>]`
///
/// `cue=` があるときは、台本を流す script（scripts/reality/run-real-meeting.sh）が書く 1 語
/// （pause / resume / stop）で進み、こちらは `<outDir>/state`（recording / paused）を返す。
/// 固定秒で待つと、一時停止の窓と台本の声が噛み合わず「漏れ 0」が何も測っていなかった。
///
/// REAL_MEETING の Astra 側。**人が相手をしない**会議を、検出 → 録音 → Notes / Captions / Ask →
/// 一時停止（漏れ 0）→ 再開 → 停止 → Library → 出所の順で通し、判定に要るものを `result.json` に書く。
/// 判定は `tools/meet-bot/judge-meeting.py` が fixture と突き合わせる（人が PASS を出さない）。
///
///   audio    既定。実マイク（BlackHole 経由で bot の固定 WAV が届く）とオンデバイス STT を使う。
///   simulate 音を使わず、corpus の lines.tsv を確定行として入れる（判定器の配線を確かめる口。gate ではない）。
///   force    MeetingDetector を待たず Google Meet として始める（bot が無い環境）。
extension SelfTest {
    @MainActor
    static func realMeeting(_ args: [String]) {
        let i = args.firstIndex(of: "--selftest")!
        let outDir = args.count > i + 2 ? args[i + 2] : "/tmp/astra-real-meeting/astra"
        let simulate = args.contains("simulate")
        let force = args.contains("force")
        let seconds = Double(args.first { $0.hasPrefix("seconds=") }?.dropFirst(8) ?? "") ?? 40
        let cuePath = args.first { $0.hasPrefix("cue=") }.map { String($0.dropFirst(4)) }
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        func settle(_ s: Double) {
            let until = Date().addingTimeInterval(s)
            while Date() < until { CFRunLoopRunInMode(.defaultMode, 0.05, true) }
        }
        func writeState(_ s: String) { try? s.write(toFile: "\(outDir)/state", atomically: true, encoding: .utf8) }
        func waitCue(_ want: String, timeout: TimeInterval) -> Bool {
            guard let cuePath else { return false }
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if let s = try? String(contentsOfFile: cuePath, encoding: .utf8),
                   s.trimmingCharacters(in: .whitespacesAndNewlines) == want { return true }
                settle(0.2)
            }
            return false
        }
        var timings: [String: Int] = [:]
        var errors: [String] = []
        let t0 = Date()
        func lap(_ k: String) { timings[k] = Int(Date().timeIntervalSince(t0) * 1000) }

        _ = LocalStore.shared.open()
        MeetingSessionStore.shared.load()
        let store = AstraStateStore.shared
        let recording = RecordingWorkspaceState.shared
        let sessions = MeetingSessionStore.shared
        WindowCoordinator.shared.showVoiceHUD(); settle(0.6)

        // ① 検出。bot が Meet を開くと Chrome の題に Meet が出る（MeetingDetector）。無ければ force。
        var detected = "none"
        let detectDeadline = Date().addingTimeInterval(force ? 0 : 30)
        repeat {
            MeetingDetector.refresh()
            if let app = store.state.meeting.detectedApp { detected = app; break }
            settle(0.5)
        } while Date() < detectDeadline
        if detected == "none" {
            if force { store.meetingDetected(app: "Google Meet"); detected = "forced" }
            else { errors.append("会議を検出できない（force で始める）") }
        }
        lap("detected")

        // ② 録音。実マイク or simulate。
        recording.start(captureSystemAudio: !simulate && args.contains("systemaudio")); settle(1.0)
        if simulate { recording.markAudioLiveForShot(); RecordingRuntime.shared.markListening(.localUser) }
        guard let liveId = sessions.live?.id else {
            print("SELFTEST_FAIL realmeeting: 録音が始まっていない"); exit(2)
        }
        lap("recording")
        writeState("recording")
        VoiceHUDState.shared.toggleMeetingPanel(.notes); settle(0.4)

        // ③ 発言を待つ（audio）／入れる（simulate）。
        if simulate {
            let corpus = URL(fileURLWithPath: outDir).deletingLastPathComponent().appendingPathComponent("corpus/lines.tsv")
            let text = (try? String(contentsOf: corpus, encoding: .utf8)) ?? ""
            var at: TimeInterval = 5
            for line in text.split(separator: "\n") {
                let parts = line.split(separator: "\t", omittingEmptySubsequences: false)
                guard parts.count >= 2 else { continue }
                recording.appendFinal(TranscriptSegment(speaker: String(parts[0]), text: String(parts[1]), interim: false, at: at))
                at += 12
                settle(0.3)
            }
        } else if cuePath != nil {
            if !waitCue("pause", timeout: seconds) { errors.append("cue pause が \(Int(seconds)) 秒来ない") }
        } else {
            let deadline = Date().addingTimeInterval(seconds)
            while Date() < deadline { settle(0.5) }
        }
        lap("spoken")
        VoiceHUDState.shared.toggleMeetingPanel(.captions); settle(0.4)
        VoiceHUDState.shared.toggleMeetingPanel(.ask); settle(0.4)
        VoiceHUDState.shared.toggleMeetingPanel(.ask); settle(0.2)

        // ④ 一時停止。止まっている間に確定行が増えたら漏れ。
        recording.togglePause(); settle(0.3)
        if !recording.isPaused { errors.append("一時停止にならない") }
        // 止める直前まで言っていた発話は、止めたあと utteranceGap で確定する。それは漏れではない。
        settle(SpeechTranscriber.utteranceGap + SpeechTranscriber.closeTimeout + 0.5)
        let beforePause = recording.transcript.filter { !$0.interim }.count
        let audioFramesBeforePause = RecordingRuntime.shared.systemAudioFrames
        writeState("paused")
        if simulate {
            // 止まっている間に入れようとしても増えないのが仕様なら、ここで入れる。増えたら漏れ。
            settle(2.0)
        } else if cuePath != nil {
            // script が止まっている間の声を流し、resume の cue を書く。
            if !waitCue("resume", timeout: 30) { errors.append("cue resume が来ない") }
        } else {
            settle(6.0)
        }
        let duringPause = recording.transcript.filter { !$0.interim }.count
        let pauseLeak = max(0, duringPause - beforePause)
        let audioFramesAfterPause = RecordingRuntime.shared.systemAudioFrames
        recording.togglePause(); settle(0.5)
        let resumed = !recording.isPaused
        writeState("recording")
        if simulate {
            recording.appendFinal(TranscriptSegment(speaker: "B", text: "再開後の発言です。", interim: false, at: 90)); settle(0.3)
        } else if cuePath != nil {
            if !waitCue("stop", timeout: seconds) { errors.append("cue stop が来ない") }
            settle(SpeechTranscriber.utteranceGap + 0.5)
        } else { settle(6.0) }
        let resumeRows = recording.transcript.filter { !$0.interim }.count - duringPause
        lap("paused")

        // ⑤ 停止 → ready → Library の 1 件 → 出所。
        let transcript = recording.transcript.filter { !$0.interim }.map { ["speaker": $0.speaker, "text": $0.text, "at": $0.at] as [String: Any] }
        // 止める前に読む（止めると session が無くなり recordedMs が 0 になる）。
        let listening = Array(RecordingRuntime.shared.listening).map(\.rawValue).sorted()
        let sttUnavailable = RecordingRuntime.shared.transcriptionUnavailable
        let recordedMs = RecordingRuntime.shared.recordedMs()
        let sttFinals = RecordingRuntime.shared.sttFinals
        let sttPartials = RecordingRuntime.shared.sttPartials
        recording.stop()
        let readyDeadline = Date().addingTimeInterval(7)
        while sessions.session(id: liveId)?.status != .ready, Date() < readyDeadline { settle(0.1) }
        let ready = sessions.session(id: liveId)
        let canvas = LocalStore.shared.loadNotes(meetingId: liveId)
        let persistedT = LocalStore.shared.loadTranscript(meetingId: liveId)
        // 判定に使う文字起こしは**保存されたもの**（止めた瞬間に確定した行も入る。止める前の写しでは 0 行だった）。
        let transcriptSaved = persistedT.map { ["speaker": $0.speaker, "text": $0.text, "at": $0.at] as [String: Any] }
        MainWindowController.shared.showLibrary(.meetings); MainNav.shared.openSession = liveId; settle(1.0)
        if MainNav.shared.openSession != liveId { errors.append("Library でその 1 件が開かない") }
        lap("library")
        func items(_ xs: [CanvasItem]) -> [[String: Any]] {
            xs.map { ["text": $0.text, "at": $0.at as Any, "speaker": $0.speaker as Any] }
        }
        let result: [String: Any] = [
            "liveId": liveId, "detected": detected, "mode": simulate ? "simulate" : "audio",
            "transcript": transcriptSaved.isEmpty ? transcript : transcriptSaved,
            "transcriptLiveRows": transcript.count,
            "decisions": items(canvas.decisions), "actions": items(canvas.actions),
            "questions": items(canvas.questions), "concerns": items(canvas.concerns),
            "pauseLeak": pauseLeak, "resumed": resumed, "resumeRows": resumeRows,
            "resumeRowsSaved": max(0, persistedT.count - duringPause),
            "systemAudioFramesDuringPause": audioFramesAfterPause - audioFramesBeforePause,
            "systemAudioFramesAfterResume": RecordingRuntime.shared.systemAudioFrames - audioFramesAfterPause,
            "libraryStatus": ready?.status.rawValue ?? "nil",
            "persisted": ["transcript": persistedT.count, "decisions": canvas.decisions.count, "actions": canvas.actions.count],
            "timings": timings, "errors": errors,
            // 0 行のとき、音が来ていないのか STT が動いていないのかを言えるように。
            "listening": listening,
            "transcriptionUnavailable": sttUnavailable,
            "speechAuthorization": String(describing: SpeechTranscriber.authorization.rawValue),
            "microphone": Permissions.microphone.rawValue,
            "recordedMs": recordedMs,
            "sttFinals": sttFinals, "sttPartials": sttPartials,
            "systemAudioFrames": RecordingRuntime.shared.systemAudioFrames,
            "systemAudioPeak": RecordingRuntime.shared.systemAudioPeak,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: "\(outDir)/result.json"))
        }
        print("REALMEETING detected=\(detected) rows=\(transcript.count) decisions=\(canvas.decisions.count) actions=\(canvas.actions.count) pauseLeak=\(pauseLeak) resumed=\(resumed) library=\(ready?.status.rawValue ?? "nil")")
        if errors.isEmpty {
            print("SELFTEST_OK realmeeting: \(simulate ? "simulate" : "audio") → \(outDir)/result.json（判定は tools/meet-bot/judge-meeting.py）")
            exit(0)
        } else {
            print("SELFTEST_FAIL realmeeting: \(errors.joined(separator: ", "))")
            exit(2)
        }
    }
}
