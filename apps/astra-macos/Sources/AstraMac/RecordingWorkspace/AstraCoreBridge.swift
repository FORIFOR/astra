import Foundation
import AstraCore

/// SwiftUI/ViewModel と astra-core(UniFFI) の間の薄い層。
/// View から FFI を直接呼ばず、ここを通す（SwiftUI → AstraCoreBridge → UniFFI → Rust）。
enum AstraCoreBridge {
    /// 疎通確認にも使う core のバージョン。
    static var coreVersion: String { astraCoreVersion() }

    /// 録音の生の状態 → 表示（経過ラベル・状態文・オフライン表示）。派生の実装は Rust に一本化。
    static func snapshot(
        elapsedMs: UInt64, isPaused: Bool, link: LinkState, pendingMs: UInt64
    ) -> RecordingSnapshot {
        recordingSnapshot(input: RecordingInput(
            elapsedMs: elapsedMs, isPaused: isPaused, link: link, pendingMs: pendingMs))
    }

    /// 前回落ちたまま残っている録音。
    static func recoverable(root: String, active: String?) -> [RecoverableMeeting] {
        scanRecoverable(root: root, active: active)
    }

    // gateway（実バックエンド）を core 経由で叩く。Tauri を介さない。
    static func reachable(_ baseUrl: String) -> Bool { apiReachable(baseUrl: baseUrl) }
    static func devSignIn(_ baseUrl: String, email: String, displayName: String) throws -> Tokens {
        try apiDevSignIn(baseUrl: baseUrl, email: email, displayName: displayName)
    }
    static func me(_ baseUrl: String, accessToken: String) throws -> Me {
        try apiMe(baseUrl: baseUrl, accessToken: accessToken)
    }
    static func createMeeting(_ baseUrl: String, accessToken: String, title: String, language: String) throws -> String {
        try apiCreateMeeting(baseUrl: baseUrl, accessToken: accessToken, title: title, language: language)
    }
    static func finishMeeting(_ baseUrl: String, accessToken: String, meetingId: String) throws -> String {
        try apiFinishMeeting(baseUrl: baseUrl, accessToken: accessToken, meetingId: meetingId)
    }
    static func uploadMeetingAudio(_ baseUrl: String, accessToken: String, meetingId: String, journalRoot: String) throws -> UInt64 {
        try apiUploadMeetingAudio(baseUrl: baseUrl, accessToken: accessToken, meetingId: meetingId, journalRoot: journalRoot)
    }
}
