import AppKit

/// シークレットモード。**画面共有・画面録画に Astra を映さない。**
///
/// 会議中に相手と画面を共有していると、Astra のノートや文字起こしまで相手に見える。
/// それは見せるつもりのない情報なので、既定で隠せる必要がある。
///
/// 仕組みは `NSWindow.sharingType = .none`。これは window server の側で
/// 「この窓は他プロセスのキャプチャに含めない」と宣言するもので、
/// ScreenCaptureKit / CGWindowList / 画面共有アプリのいずれからも外れる。
///
/// **限界を隠さない**: これは配信側アプリの協力に頼らない仕組みだが、
/// 物理的なカメラやミラーリング機器までは防げない。§22 の Presentation Guard と
/// 併せて使う（あちらは「そもそも出さない」、こちらは「出ていても映らない」）。
@MainActor
final class SecretMode: ObservableObject {
    static let shared = SecretMode()

    private static let key = "astra.secretMode"

    @Published private(set) var isOn: Bool = UserDefaults.standard.bool(forKey: "astra.secretMode")

    func set(_ on: Bool) {
        guard isOn != on else { return }
        isOn = on
        UserDefaults.standard.set(on, forKey: Self.key)
        apply()
    }

    func toggle() { set(!isOn) }

    /// いま出ている Astra の窓すべてに反映する。
    func apply() {
        for window in NSApp.windows {
            window.sharingType = isOn ? .none : .readOnly
        }
    }

    /// その窓が本当にキャプチャから外れているか。検査から使う。
    static func isHidden(_ window: NSWindow) -> Bool { window.sharingType == .none }
}
