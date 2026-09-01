import Foundation
import AstraCore

/// 録音の実行時。マイク → astra-core(RecordingSession) → ディスク断片。
/// SwiftUI から直接触らず、State/Bridge 経由で使う。
@MainActor
final class RecordingRuntime {
    static let shared = RecordingRuntime()

    private var session: RecordingSession?
    /// §12 声が乗っている間だけ STT へ流す門番。
    private var vad = VoiceActivityDetector()
    /// §12 partial が UI に出るまでの実測（最後の 1 件、ミリ秒）。
    private(set) var lastPartialLatencyMs: Double = 0
    private var speechStartedAt: Date?
    /// §19 いま STT に流している音がどちらから来たか。混合波では失われる情報。
    private(set) var currentChannel: SpeakerChannel = .localUser
    /// 直近の文字起こしがどちらの声だったか（UI の話者名に使う）。
    private(set) var lastTranscriptChannel: SpeakerChannel = .localUser

    /// **実際に音が届いている経路。** 意図ではなく実測を持つ。
    ///
    /// 画面収録の許可が無いと system audio は黙って落ちて mic だけになる。
    /// 「相手の声も拾っているつもり」で拾えていない状態が、画面から分からなかった。
    @Published private(set) var listening: Set<SpeakerChannel> = []

    /// 音が 1 フレーム届いたことを記録する。音声の callback と検査の両方から呼ぶ。
    /// 検査だけ別経路にすると、検査が本番と違う姿を測ることになる。
    func markListening(_ ch: SpeakerChannel) {
        guard !listening.contains(ch) else { return }
        // 既に main なら**その場で**入れる。async に回すと、検査が撮る頃には
        // まだ反映されておらず「音が届いていません」の姿を撮ってしまう。
        if Thread.isMainThread { listening.insert(ch) }
        else { DispatchQueue.main.async { self.listening.insert(ch) } }
    }
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
    /// 実際に journal を作った id（サインイン時は gateway id、そうでなければローカル id）。
    private(set) var activeMeetingId: String = "adhoc"
    private var apiBase: String?
    private var accessToken: String?

    /// サインイン済みなら、実バックエンドの会議 id を使って録音する。
    func configureBackend(base: String, accessToken: String) {
        self.apiBase = base
        self.accessToken = accessToken
    }

    /// 保存先（Application Support/Astra/meetings）。core の既定と同じ。
    /// 置き場所は `LocalStore.dataRoot` に合わせる（DB と録音が別の場所へ行くと、
    /// 初回起動の検証で片方だけまっさらになる）。
    private var root: String {
        LocalStore.dataRoot.appendingPathComponent("meetings").path
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
        self.activeMeetingId = id
        if transcribe, SpeechTranscriber.authorization == .authorized {
            let st = SpeechTranscriber()
            do {
                try st.start { [weak self] live in
                    // §12 partial は final を待たずに UI へ。出るまでの時間を実測しておく。
                    let started = self?.speechStartedAt
                    let channel = self?.currentChannel ?? .localUser
                    DispatchQueue.main.async {
                        if let started { self?.lastPartialLatencyMs = Date().timeIntervalSince(started) * 1000 }
                        self?.lastTranscriptChannel = channel
                        self?.onTranscript?(live.text, live.isFinal)
                        // Dock が listening のときは、そこにも途中経過を出す。
                        if !live.isFinal { VoiceHUDState.shared.updatePartial(live.text) }
                    }
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
                    // §12 VAD: 声が乗っているフレームだけ STT へ流す（無音を延々と認識させない）。
                    // 一時停止中は文字起こしもしない（session 側は core が sample を捨てる）。
                    if self?.paused != true, self?.vad.accept(frame) == true {
                        self?.currentChannel = .localUser
                        self?.markListening(.localUser)
                        if self?.speechStartedAt == nil { self?.speechStartedAt = Date() }
                        self?.speech?.append(frame, sampleRate: 16_000)
                    }
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
                    try await sys.start { [weak self] frame in
                        _ = session?.pushSamples(samples: frame, sampleRate: 16_000)
                        // §19 相手の声は remote_audio として扱う。混ぜてから起こすと主語が消える。
                        self?.currentChannel = .remoteAudio
                        self?.markListening(.remoteAudio)
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
        vad.reset()
        speechStartedAt = nil
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
            if let _ = try? AstraCoreBridge.uploadMeetingAudio(base, accessToken: token, meetingId: id, journalRoot: root) {
                _ = try? AstraCoreBridge.finishMeeting(base, accessToken: token, meetingId: id)
                AstraCoreBridge.markUploaded(root: root, meetingId: id)  // 二重回復を防ぐ
            }
        }
        meetingId = nil
    }

    /// 録りかけを 1 件捨てる。**音は消える。戻せない。**
    ///
    /// 送り先が無いと `recover` は何もできないので、捨てる道が無いと
    /// 「録りかけが N 件あります」を永久に見続けることになる（実測で 150 件まで
    /// 溜まった）。消せないお知らせは、ただの雑音になる。
    @discardableResult
    func discard(meetingId id: String) -> Bool {
        // 走っている録音は消さない。
        //
        // 判定は**開いている journal**で見る。`meetingId` はサインインしている
        // ときしか入らず、`end()` で nil に戻るので、これだけでは録音中を
        // 取りこぼす（実際、録音中のものを消せてしまった）。
        guard !(session != nil && id == activeMeetingId) else { return false }
        guard id != meetingId else { return false }
        let dir = root + "/" + id
        // 置き場の外を消さない（id に .. などが混ざっても root の下に留める）。
        guard URL(fileURLWithPath: dir).standardizedFileURL.path.hasPrefix(
                URL(fileURLWithPath: root).standardizedFileURL.path + "/") else { return false }
        do { try FileManager.default.removeItem(atPath: dir); return true } catch { return false }
    }

    /// 前回落ちたまま残っている録音（未アップロードの断片）。起動時に surface する。
    /// 落ちたまま残っている録音。**正常に終わったものは含めない。**
    ///
    /// journal は送り終えるまで残るので、サインインしていない機械では
    /// 普通に停止した会議まで候補に入っていた。Home が
    /// 「保存し切る前に終わった録音です」と言うが、それは嘘になる。
    /// 手元で ready / processing まで進んだ会議は、落ちていない。
    func recoverableMeetings() -> [RecoverableMeeting] {
        let finished = Set(MeetingSessionStore.shared.sessions
            .filter { $0.status == .ready || $0.status == .processing }
            .map { $0.id })
        return AstraCoreBridge.recoverable(root: root, active: nil)
            .filter { !finished.contains($0.meetingId) }
    }

    /// クラッシュした録音を復旧する: その会議の断片を gateway に送って finalize する。
    /// サインイン済みでなければ 0（送れない）。送ったバイト数を返す。
    ///
    /// **オフライン録音**（サインイン前に録った local id, `meeting-…`）は gateway 会議が無いので、
    /// 新しく会議を作り、journal ディレクトリをその id にリネームしてから送る（でないと永久に候補に残る）。
    @discardableResult
    func recover(meetingId id: String) -> UInt64 {
        guard let base = apiBase, let token = accessToken else { return 0 }
        var uploadId = id
        if id.hasPrefix("meeting-") {   // オフライン録音 → 新しい gateway 会議を作って紐付ける
            guard let created = try? AstraCoreBridge.createMeeting(base, accessToken: token, title: "会議（復旧）", language: "ja-JP") else { return 0 }
            let from = root + "/" + id, to = root + "/" + created
            do { try FileManager.default.moveItem(atPath: from, toPath: to) } catch { return 0 }
            uploadId = created
        }
        let sent = (try? AstraCoreBridge.uploadMeetingAudio(base, accessToken: token, meetingId: uploadId, journalRoot: root)) ?? 0
        _ = try? AstraCoreBridge.finishMeeting(base, accessToken: token, meetingId: uploadId)
        if sent > 0 { AstraCoreBridge.markUploaded(root: root, meetingId: uploadId) }  // 二重回復を防ぐ
        return sent
    }
}
