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
}
