import Foundation
import AstraCore

/// 録音の実行時。マイク → astra-core(RecordingSession) → ディスク断片。
/// SwiftUI から直接触らず、State/Bridge 経由で使う。
@MainActor
final class RecordingRuntime {
    static let shared = RecordingRuntime()

    private var session: RecordingSession?
    private var mic: MicCapture?
    private var sysAudio: AnyObject?
    private var speech: SpeechTranscriber?
    private var paused = false
    /// 途中経過/確定の文字起こしを UI へ渡す（オンデバイス STT）。
    var onTranscript: ((String, Bool) -> Void)?
    /// マイクの音量（0..1）を UI（波形）へ渡す。
    var onLevel: ((Float) -> Void)?
    /// 実 gateway に作った会議（サインイン時のみ）。無ければローカル録音だけ。
    private var meetingId: String?
    private var apiBase: String?
    private var accessToken: String?

    /// サインイン済みなら、実バックエンドの会議 id を使って録音する。
    func configureBackend(base: String, accessToken: String) {
        self.apiBase = base
        self.accessToken = accessToken
    }

    /// 保存先（Application Support/Astra/meetings）。core の既定と同じ。
    private var root: String {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return (base ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("Astra/meetings").path
    }

    /// core にセッションを作り、（可能なら）マイクを開く。live 取り込みは .app + 許可が要る。
    @discardableResult
    func begin(meetingId localId: String, captureMic: Bool = true,
               captureSystemAudio: Bool = false, transcribe: Bool = true) -> Bool {
        try? FileManager.default.createDirectory(
            atPath: root, withIntermediateDirectories: true)
        // サインイン済みなら実 gateway に会議を作り、その id で録音する（Tauri を介さない）
        var id = localId
        if let base = apiBase, let token = accessToken,
           let created = try? AstraCoreBridge.createMeeting(base, accessToken: token, title: "会議", language: "ja-JP") {
            id = created
            self.meetingId = created
        }
        guard let session = try? RecordingSession.start(root: root, meetingId: id) else {
            return false
        }
        self.session = session
        if transcribe, SpeechTranscriber.authorization == .authorized {
            let st = SpeechTranscriber()
            do {
                try st.start { [weak self] live in
                    DispatchQueue.main.async { self?.onTranscript?(live.text, live.isFinal) }
                }
                self.speech = st
            } catch {
                NSLog("on-device STT unavailable: \(error)")   // 許可が無ければ録音だけ続ける
            }
        }
        if captureMic {
            let mic = MicCapture()
            do {
                try mic.start { [weak self, weak session] frame in
                    _ = session?.pushSamples(samples: frame, sampleRate: 16_000)
                    // 一時停止中は文字起こしもしない（session 側は core が sample を捨てる）。
                    if self?.paused != true { self?.speech?.append(frame, sampleRate: 16_000) }
                    // 波形用の音量（peak）を出す。
                    var peak: Float = 0
                    for v in frame { let a = abs(v); if a > peak { peak = a } }
                    let level = min(1, peak * 1.6)   // 見やすさのため少し持ち上げる
                    DispatchQueue.main.async { self?.onLevel?(level) }
                }
                self.mic = mic
            } catch {
                // マイクが開けなくてもセッションは成り立たせる（サンプルは外から push できる）
                NSLog("mic capture unavailable: \(error)")
            }
        }
        if captureSystemAudio, #available(macOS 13.0, *) {
            let sys = SystemAudioCapture()
            self.sysAudio = sys
            Task { [weak session] in
                do {
                    try await sys.start { frame in
                        _ = session?.pushSamples(samples: frame, sampleRate: 16_000)
                    }
                } catch {
                    // 画面収録許可が無ければ system audio 無しで続ける（mic だけで成り立つ）
                    NSLog("system audio capture unavailable: \(error)")
                }
            }
        }
        return true
    }

    /// テスト・外部音源用に直接サンプルを流す（headless E2E で使う）。
    func push(_ samples: [Float], sampleRate: UInt32) {
        _ = session?.pushSamples(samples: samples, sampleRate: sampleRate)
    }

    func snapshot() -> RecordingSnapshot? { session?.snapshot() }
    func recordedMs() -> UInt64 { session?.recordedMs() ?? 0 }
    func setPaused(_ paused: Bool) {
        self.paused = paused
        session?.setPaused(paused: paused)
    }

    /// 停止して確定。書けた断片は残り、回復候補になる。
    func end() {
        mic?.stop(); mic = nil
        speech?.finish(); speech = nil
        if #available(macOS 13.0, *), let sys = sysAudio as? SystemAudioCapture {
            Task { await sys.stop() }
        }
        sysAudio = nil
        try? session?.finish()
        session = nil
        // 実 gateway の会議なら、録音を送ってから finalize を投げる（作成→録音→送信→終了）
        if let base = apiBase, let token = accessToken, let id = meetingId {
            _ = try? AstraCoreBridge.uploadMeetingAudio(base, accessToken: token, meetingId: id, journalRoot: root)
            _ = try? AstraCoreBridge.finishMeeting(base, accessToken: token, meetingId: id)
        }
        meetingId = nil
    }
}
