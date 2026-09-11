import AppKit
import SwiftUI
import XCTest
@testable import AstraMac

/// 窓が mouse を奪わないこと、対象未発見の fallback、追従、終了時の解放。
@MainActor
final class GuideCoordinatorTests: XCTestCase {
    override func setUp() { _ = NSApplication.shared }

    func testFloatingPanelIsTransparentNonActivatingAndPassesClicks() {
        let p = FloatingPanel(size: NSSize(width: 100, height: 40), content: AnyView(HighlightView()), passthrough: true)
        XCTAssertTrue(p.styleMask.contains(.borderless))
        XCTAssertTrue(p.styleMask.contains(.nonactivatingPanel))
        XCTAssertFalse(p.isOpaque)
        XCTAssertEqual(p.backgroundColor, .clear)
        XCTAssertFalse(p.hasShadow)
        XCTAssertTrue(p.isFloatingPanel)
        XCTAssertFalse(p.hidesOnDeactivate)
        XCTAssertTrue(p.becomesKeyOnlyIfNeeded)
        XCTAssertFalse(p.canBecomeKey)
        XCTAssertFalse(p.canBecomeMain)
        XCTAssertTrue(p.ignoresMouseEvents)
        for b in [NSWindow.CollectionBehavior.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle] {
            XCTAssertTrue(p.collectionBehavior.contains(b))
        }
        if #available(macOS 13.0, *) { XCTAssertTrue(p.collectionBehavior.contains(.canJoinAllApplications)) }
        p.orderOut(nil)
    }

    func testHighlightAndCalloutNeverTakeMouseEventsAndStayOnScreen() {
        let highlight = HighlightOverlayController()
        let target = CGRect(x: 300, y: 300, width: 60, height: 24)
        highlight.show(around: target)
        XCTAssertEqual(highlight.panelIgnoresMouse, true)
        XCTAssertEqual(highlight.frame, CalloutPlacer.highlightFrame(target: target))
        let callout = GuideCalloutController()
        let screen = NSScreen.screens[0]
        callout.show(message: "Astra をオンにしてください", near: target, screen: screen)
        XCTAssertEqual(callout.panelIgnoresMouse, true)
        XCTAssertNotNil(callout.placement)
        XCTAssertTrue(screen.visibleFrame.contains(callout.frame!))
        highlight.hide(); callout.hide()
        XCTAssertFalse(highlight.isVisible); XCTAssertFalse(callout.isVisible)
    }

    func testRealOverlayStackReleasesEveryPanel() {
        let stack = GuideOverlayStack()
        stack.showAvatar(state: .guiding, message: "案内", onClose: {})
        let anchor = GuideAnchor(rect: CGRect(x: 200, y: 200, width: 40, height: 20),
                                 match: AXMatch(node: AXElementSnapshot(role: "AXCheckBox", title: "Astra"), selectorRank: 0))
        stack.showGuide(message: "Astra をオンにしてください", at: anchor, preferred: .left)
        XCTAssertEqual(stack.visiblePanelCount, 3)
        XCTAssertTrue(stack.avatar.isVisible)
        stack.hideAll()
        XCTAssertEqual(stack.visiblePanelCount, 0)
    }

    func testMissingTargetShowsOnlyTheGeneralGuideAndDoesNotCrash() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted],
                        tree: settingsTree(withAstra: false, withAdd: false))
        h.coordinator.start()
        h.coordinator.tick()
        XCTAssertEqual(h.coordinator.state, .waitingScreenCapture)
        XCTAssertFalse(h.overlay.guideVisible, "推測位置には出さない")
        XCTAssertNil(h.coordinator.anchor)
        XCTAssertEqual(h.overlay.avatarMessage, PermissionGuideCoordinator.messageGeneralTurnOn)
        XCTAssertEqual(h.overlay.avatarAction, PermissionGuideCoordinator.actionOpenSettings, "文章だけで放り出さない")
        XCTAssertTrue(h.coordinator.lastLocateReason?.hasPrefix("no match") == true)
        // AX を辿れない（未許可）ときも同じ。
        h.tree.isTrusted = false
        h.coordinator.handleAXEvent("AXMoved")
        XCTAssertFalse(h.overlay.guideVisible)
        XCTAssertEqual(h.coordinator.lastLocateReason, "accessibility not trusted")
    }

    func testAddButtonIsGuidedWhenAstraRowIsMissing() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted],
                        tree: settingsTree(withAstra: false, withAdd: true))
        h.coordinator.start(); h.coordinator.tick()
        XCTAssertTrue(h.overlay.guideVisible)
        XCTAssertEqual(h.overlay.guideMessage, PermissionGuideCoordinator.calloutAdd(for: "Astra"))
        XCTAssertEqual(h.overlay.guidePlacement, .below, "「+」は下に置く（横は「−」を隠す）")
    }

    func testGuideFollowsWhenSystemSettingsMoves() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted])
        h.coordinator.start(); h.coordinator.tick()
        let before = h.coordinator.anchor?.rect
        XCTAssertNotNil(before)
        h.tree.tree = settingsTree(astraFrame: CGRect(x: 700, y: 400, width: 40, height: 22))
        h.observer.fire("AXMoved")
        XCTAssertNotEqual(h.coordinator.anchor?.rect, before)
        XCTAssertEqual(h.overlay.guideAnchor?.rect, h.coordinator.anchor?.rect)
        XCTAssertEqual(h.tree.walks, 3, "起動確認 1 + 最初の探索 1 + 出来事 1。tick では取り直さない")
        h.coordinator.tick()
        XCTAssertEqual(h.tree.walks, 3, "対象があり observer が動いている間、tick は権限を読むだけ（polling しない）")
    }

    func testFallbackTickRelocatesOnlyWhenObserverIsUnavailable() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted])
        h.observer.canStart = false
        h.coordinator.start(); h.coordinator.tick()
        XCTAssertEqual(h.coordinator.state, .waitingScreenCapture)
        let walks = h.tree.walks
        h.coordinator.tick()
        XCTAssertEqual(h.tree.walks, walks + 1, "AXObserver が無いときだけ低頻度で取り直す")
    }

    func testStopReleasesPanelsObserversAndReturnsToIdle() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted])
        h.coordinator.start(); h.coordinator.tick()
        XCTAssertTrue(h.observer.isRunning)
        XCTAssertEqual(h.overlay.visiblePanelCount, 3)
        h.overlay.onClose?()   // アバターの × と同じ
        XCTAssertEqual(h.coordinator.state, .idle)
        XCTAssertFalse(h.observer.isRunning)
        XCTAssertEqual(h.overlay.visiblePanelCount, 0)
        XCTAssertFalse(h.coordinator.hasLiveWatchers)
        XCTAssertNil(h.coordinator.anchor)
    }
}


@MainActor
final class GuideAlreadyOnTests: XCTestCase {
    func testASwitchThatIsAlreadyOnIsNotAskedToBeTurnedOn() {
        // 画面収録はオンにしても再起動まで許可が返らない。その間「オンにしてください」と言うと状態と矛盾する（盲検 3/3）。
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted],
                        tree: settingsTree(astraOn: true))
        h.coordinator.start(); h.coordinator.tick()
        XCTAssertEqual(h.overlay.guideMessage, PermissionGuideCoordinator.calloutAlreadyOn(for: "Astra"))
        XCTAssertTrue(h.overlay.guideMessage!.contains("再起動"))
    }

    func testCalloutTailAimsAtTheTargetCentre() {
        let target = CGRect(x: 400, y: 300, width: 40, height: 20)
        let size = CGSize(width: 200, height: 40)
        let left = CalloutPlacer.candidate(target: target, size: size, placement: .left)
        XCTAssertEqual(left.maxX, target.minX - CalloutPlacer.gap)
        XCTAssertEqual(left.midY, target.midY)
        let below = CalloutPlacer.candidate(target: target, size: size, placement: .below)
        XCTAssertEqual(below.midX, target.midX)
    }
}
