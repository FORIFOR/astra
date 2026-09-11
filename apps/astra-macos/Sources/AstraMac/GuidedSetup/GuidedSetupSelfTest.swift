import AppKit
import Foundation

/// `--selftest guidedsetup [outDir]`: Guided Setup を実機で回す（人手 0）。
///
/// 権限は**変えない・求めない**（OS のダイアログを出さない）。実際の System Settings を開き、AX で対象を探し、
/// 案内の窓が System Settings のクリックを奪わないこと、終了で窓と監視が残らないことを確かめる。
/// AX 許可が無い端末（署名の無い debug 実行体など）では対象は見つからないので、その旨を **fallback** として
/// 報告する（見つかったふりはしない）。
extension SelfTest {
    @MainActor
    static func guidedSetupGate(_ args: [String]) {
        let i = args.firstIndex(of: "--selftest")!
        let outDir = args.count > i + 2 ? args[i + 2] : "/tmp/astra-guided-setup"
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        func settle(_ s: Double) { let u = Date().addingTimeInterval(s); while Date() < u { CFRunLoopRunInMode(.defaultMode, 0.05, true) } }
        var fail: [String] = []
        func check(_ ok: Bool, _ msg: String) { if !ok { fail.append(msg) } }

        // `--simulate-not-granted`: 画面収録を「未許可」として扱い、System Settings を実際に開いて AX で対象を探す経路を通す
        // （許可済みの端末でも案内の経路を測れる。権限そのものには触らない）。
        let simulateNotGranted = args.contains("--simulate-not-granted")
        let settingsWasRunning = AXElementService.shared.pid(ofBundle: SystemSettingsAnchorLocator.bundleID) != nil

        /// 実 API を読むが、求めない（OS のダイアログを出さない）。
        final class ReadOnlyPermissions: PermissionProviding {
            var simulateScreenNotGranted = false
            func state(of permission: GuidePermission) -> Permissions.State {
                if permission == .screenCapture, simulateScreenNotGranted { return .notDetermined }
                return PermissionManager.shared.state(of: permission)
            }
            func promptAccessibility() -> Bool { Permissions.accessibility == .granted }
            func requestScreenCapture() -> Bool { state(of: .screenCapture) == .granted }
            func requestMicrophone(_ done: @escaping (Bool) -> Void) { done(Permissions.microphone == .granted) }
            func openSettings(for permission: GuidePermission) { PermissionManager.shared.openSettings(for: permission) }
        }
        let overlay = GuideOverlayStack()
        var deps = PermissionGuideCoordinator.Dependencies.live()
        let readOnly = ReadOnlyPermissions()
        readOnly.simulateScreenNotGranted = simulateNotGranted
        deps.permissions = readOnly
        deps.overlay = overlay
        // `--app-name X`: 一覧に出る名前（debug 実行体は "AstraDbg" のバンドルで登録されていることがある）。
        if let ai = args.firstIndex(of: "--app-name"), ai + 1 < args.count { deps.appNames = [args[ai + 1]] + deps.appNames }
        deps.successDwell = 0.2
        deps.fallbackInterval = 0.5
        let coordinator = PermissionGuideCoordinator(dependencies: deps)

        let axTrusted = AXElementService.shared.isTrusted
        let screenGranted = readOnly.state(of: .screenCapture) == .granted
        coordinator.start(order: [.screenCapture])
        settle(0.3)
        check(overlay.avatar.isVisible, "アバターが出ない")
        if let screen = NSScreen.main, let f = overlay.avatar.panelFrame {
            let v = screen.visibleFrame
            check(abs(f.maxX - (v.maxX - AvatarLayout.inset)) < 1 && abs(f.minY - (v.minY + AvatarLayout.inset)) < 1,
                  "アバターが右下 24pt に無い \(f) in \(v)")
        }

        var anchorReport = "skipped(already granted)"
        var calloutReport = "-"
        var followReport = "-"
        if !screenGranted {
            // System Settings が現れて対象を探すまで待つ（AX の可否で結果は変わる。捏造しない）。
            let deadline = Date().addingTimeInterval(10)
            while Date() < deadline, coordinator.state != .waitingScreenCapture { settle(0.2) }
            check(coordinator.state == .waitingScreenCapture, "waitingScreenCapture に至らない (\(coordinator.state))")
            // 面が切り替わるのを待つ（低頻度 fallback が対象を取り直す）。見つかるか、6 秒で諦める。
            // 一覧は段階的に描かれる（先に「+」だけ、あとから行）。行のスイッチが出るまで少し待つ。
            let anchorDeadline = Date().addingTimeInterval(8)
            while Date() < anchorDeadline, coordinator.anchor?.match.node.role != (kAXCheckBoxRole as String) { settle(0.2) }
            // 探索結果を残す（見つからなかったときに何が在ったか）。
            if axTrusted, let pid = AXElementService.shared.pid(ofBundle: SystemSettingsAnchorLocator.bundleID),
               let tree = AXElementService.shared.applicationTree(pid: pid, maxDepth: 30, maxNodes: 20000) {
                var lines: [String] = []
                func dump(_ n: AXElementSnapshot, _ depth: Int) {
                    let f = n.axFrame.map { "\(Int($0.minX)),\(Int($0.minY)) \(Int($0.width))x\(Int($0.height))" } ?? "-"
                    lines.append(String(repeating: "  ", count: depth) + "\(n.role ?? "?")\(n.subrole.map { "/" + $0 } ?? "") title=\(n.title ?? "") desc=\(n.axDescription ?? "") id=\(n.identifier ?? "") value=\(n.value ?? "") @\(f)")
                    for c in n.children { dump(c, depth + 1) }
                }
                dump(tree, 0)
                try? lines.joined(separator: "\n").write(toFile: "\(outDir)/settings-ax-tree.txt", atomically: true, encoding: .utf8)
            }
            if let a = coordinator.anchor {
                anchorReport = "found(\(a.match.node.role ?? "?") '\(a.match.node.title ?? a.match.node.axDescription ?? "")' at \(Int(a.rect.minX)),\(Int(a.rect.minY)) \(Int(a.rect.width))x\(Int(a.rect.height)))"
                check(overlay.highlight.isVisible && overlay.callout.isVisible, "対象があるのにハイライト/吹き出しが出ない")
                check(overlay.highlight.panelIgnoresMouse == true, "ハイライトが mouse を奪う")
                check(overlay.callout.panelIgnoresMouse == true, "吹き出しが mouse を奪う")
                if let hf = overlay.highlight.frame {
                    check(hf.contains(a.rect.insetBy(dx: 1, dy: 1)), "ハイライトが対象を囲っていない")
                }
                if let cf = overlay.callout.frame, let screen = NSScreen.screens.first(where: { $0.frame.intersects(a.rect) }) {
                    check(screen.visibleFrame.contains(cf), "吹き出しが画面外 \(cf)")
                }
                calloutReport = overlay.callout.placement.map { "\($0)" } ?? "-"
                // 対象の窓を**利用者と同じ操作で**動かしたときに追従するか: タイトルバーをマウスでドラッグして、
                // anchor が更新されるのを待つ（AXObserver の出来事で取り直す）。終わったら元の位置へ戻す。
                if let pid = AXElementService.shared.pid(ofBundle: SystemSettingsAnchorLocator.bundleID),
                   axTrusted, let before = coordinator.anchor?.rect,
                   let win = AXElementService.shared.applicationTree(pid: pid, maxDepth: 1, maxNodes: 32)?.windows.first,
                   let wf = win.axFrame {
                    func drag(from a: CGPoint, to b: CGPoint) {
                        func post(_ type: CGEventType, _ p: CGPoint) {
                            CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
                            settle(0.04)
                        }
                        post(.mouseMoved, a); post(.leftMouseDown, a)
                        for i in 1...8 {
                            let t = CGFloat(i) / 8
                            post(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
                        }
                        post(.leftMouseUp, b)
                    }
                    // AX 座標（左上原点）。タイトルバーの中央やや左（閉じるボタンを避ける）。
                    let grab = CGPoint(x: wf.midX, y: wf.minY + 12)
                    let dest = CGPoint(x: grab.x + 60, y: grab.y + 40)
                    drag(from: grab, to: dest)
                    let d2 = Date().addingTimeInterval(3)
                    while Date() < d2, coordinator.anchor?.rect == before { settle(0.1) }
                    followReport = coordinator.anchor?.rect != before ? "followed" : "notFollowed"
                    check(coordinator.anchor?.rect != before, "窓をドラッグしても案内が追従しない")
                    drag(from: dest, to: grab)
                    settle(0.6)
                }
            } else {
                anchorReport = "fallback(\(coordinator.lastLocateReason ?? "?"))"
                check(!overlay.highlight.isVisible && !overlay.callout.isVisible, "対象が無いのにハイライト/吹き出しを出した（推測位置）")
                check(overlay.avatar.model.message == PermissionGuideCoordinator.messageGeneralTurnOn
                      || overlay.avatar.model.message == PermissionGuideCoordinator.messageScreenCapture,
                      "一般ガイドが出ていない: \(overlay.avatar.model.message)")
            }
        } else {
            settle(0.5)
            check(coordinator.state == .completed || coordinator.state == .idle, "許可済みなのに completed にならない (\(coordinator.state))")
        }

        // 画面全体の姿を残す（System Settings + ハイライト + 吹き出し + アバター。目視用）。
        if let full = CGDisplayCreateImage(CGMainDisplayID()) {
            let png = NSBitmapImageRep(cgImage: full).representation(using: .png, properties: [:])
            try? png?.write(to: URL(fileURLWithPath: "\(outDir)/guided-setup-screen.png"))
        }
        // アバターの姿を残す（目視用）。
        if let win = overlay.avatar.window,
           let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(win.windowNumber), [.boundsIgnoreFraming, .bestResolution]) {
            let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
            try? png?.write(to: URL(fileURLWithPath: "\(outDir)/guided-setup-avatar.png"))
        }

        // 終了: 窓も監視も残さない。
        coordinator.stop()
        settle(0.2)
        check(overlay.visiblePanelCount == 0, "終了後に窓が残る (\(overlay.visiblePanelCount))")
        check(!coordinator.hasLiveWatchers, "終了後に監視が残る")
        check(coordinator.state == .idle, "終了後に idle でない")

        // 自分が開いた System Settings だけ閉じる（利用者が開いていたものには触らない）。
        if !settingsWasRunning {
            NSRunningApplication.runningApplications(withBundleIdentifier: SystemSettingsAnchorLocator.bundleID).first?.terminate()
        }
        let summary = "ax=\(axTrusted ? "trusted" : "untrusted") screen=\(screenGranted ? "granted" : "notGranted")\(simulateNotGranted ? "(simulated)" : "") anchor=\(anchorReport) callout=\(calloutReport) follow=\(followReport) panelsAfterStop=\(overlay.visiblePanelCount)"
        if fail.isEmpty { print("SELFTEST_OK guidedsetup: \(summary)"); exit(0) }
        print("SELFTEST_FAIL guidedsetup: \(fail.joined(separator: " / ")) [\(summary)]"); exit(2)
    }
}
