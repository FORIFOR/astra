import AppKit
import SwiftUI

/// 確認カードを実際に画面へ出して、答えが返るまで待つ。
///
/// カードは Astra の面（`ConfirmationCardView`）で、NSAlert ではない。仕様書 §17 が
/// 求めているのは「AI が文章で聞く」でも「OS の警告」でもなく、**何が起きるかを書いた面**。
@MainActor
enum ConfirmationPresenter {
    /// 承認されたら true。window を出せない環境（selftest / headless）では false（＝実行しない）。
    static func present(_ confirmation: ActionConfirmation) -> Bool {
        guard !WindowCoordinator.headless else { return false }
        var answer: Bool?
        let panel = AstraPanel(
            size: NSSize(width: 320, height: 200),
            level: .modalPanel,
            canKey: true,
            content: ConfirmationCardView(confirmation: confirmation) { answer = $0 }
        )
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: f.midX - 160, y: f.midY - 100))
        }
        panel.makeKeyAndOrderFront(nil)
        // 答えが出るまで回す。押されるまで先へ進めない（黙って実行しないため）。
        let deadline = Date().addingTimeInterval(120)
        while answer == nil, Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, 0.05, true)
        }
        panel.orderOut(nil)
        return answer ?? false
    }
}
