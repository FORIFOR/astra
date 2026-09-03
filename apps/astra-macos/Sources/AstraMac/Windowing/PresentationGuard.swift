import AppKit

/// §22 画面共有が始まったら Astra を引っ込める。
///
/// macOS は「全アプリから完全にキャプチャ除外」を保証しないので、
/// 「見えないようにする」ではなく「**出さない**」で守る。既定は仕様どおり
/// 「畳む＋別ディスプレイがあればそちらへ」。
@MainActor
final class PresentationGuard: ObservableObject {
    static let shared = PresentationGuard()

    enum Response: String {
        case collapse          // Presence Dot まで畳む
        case moveToSecond      // 別ディスプレイへ逃がす
        case hide              // 完全に隠す
    }

    @Published private(set) var isSharing = false
    private var timer: Timer?

    /// 画面全体が共有されているか。共有中のアプリが画面キャプチャを走らせているかで見る。
    ///
    /// macOS には「いま画面共有中か」を直接聞ける公開 API が無いので、
    /// 画面共有を行うアプリが動いていて、かつ録画中を示す状態から**推定**する。
    /// 推定であることを隠さない —— 外したときに黙って晒さないよう、既定を安全側にしている。
    static let sharingApps: Set<String> = [
        "us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2",
        "com.cisco.webexmeetingsapp", "com.apple.ScreenSharing", "com.google.Chrome",
    ]

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        // 会議アプリが前面かつ会議として検出されている間だけ、共有の可能性を見る。
        let detected = AstraStateStore.shared.state.meeting.detectedApp != nil
        apply(sharing: detected && Self.anySharingAppRunning())
    }

    static func anySharingAppRunning() -> Bool {
        NSWorkspace.shared.runningApplications.contains {
            guard let id = $0.bundleIdentifier else { return false }
            return sharingApps.contains(id) && $0.isActive
        }
    }

    /// 判定結果を適用する。副作用はここだけ（テストから直接叩ける）。
    func apply(sharing: Bool, response: Response = .collapse) {
        guard isSharing != sharing else { return }
        isSharing = sharing
        guard !WindowCoordinator.headless else { return }
        if sharing {
            switch response {
            case .collapse, .hide:
                WindowCoordinator.shared.hideVoiceHUD()
            case .moveToSecond:
                WindowCoordinator.shared.showVoiceHUD()
            }
        } else {
            // 共有が終わったら戻す。録音中こそ Stop の載った Dock が要る
            // （以前は mode == .meeting の間は戻らず、Stop が押せなくなっていた）。
            WindowCoordinator.shared.showVoiceHUD()
        }
    }
}
