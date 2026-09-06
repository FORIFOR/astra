import XCTest
@testable import AstraMac

/// 状態機械の正常遷移と、権限が付いたときの自動遷移、denied / notDetermined の道。
@MainActor
final class PermissionGuideStateTests: XCTestCase {
    func testPlanSkipsGrantedPermissionsAndKeepsOrder() {
        let plan = GuidePlan { $0 == .screenCapture }
        XCTAssertEqual(plan.pending, [.accessibility, .microphone])
        XCTAssertEqual(plan.next, .accessibility)
        var p = plan; p.finish(.accessibility)
        XCTAssertEqual(p.next, .microphone)
    }

    func testStateKnowsItsPermissionAndWhetherItWaits() {
        XCTAssertEqual(PermissionGuideState.waitingScreenCapture.permission, .screenCapture)
        XCTAssertTrue(PermissionGuideState.waitingScreenCapture.isWaiting)
        XCTAssertFalse(PermissionGuideState.screenCaptureIntro.isWaiting)
        XCTAssertNil(PermissionGuideState.completed.permission)
        XCTAssertTrue(PermissionGuideState.failed("x").isTerminal)
    }

    func testEverythingGrantedCompletesImmediately() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .granted, .microphone: .granted])
        h.coordinator.start()
        // dwell 0 なので completed → idle まで即時に進み、窓は残らない。
        XCTAssertEqual(h.coordinator.state, .idle)
        XCTAssertTrue(h.overlay.log.contains("avatar:success"))
        XCTAssertEqual(h.overlay.visiblePanelCount, 0)
    }

    func testFullHappyPathThroughAllThreePermissions() {
        let h = Harness(states: [.accessibility: .notDetermined, .screenCapture: .notDetermined, .microphone: .notDetermined],
                        settingsRunning: false)
        h.coordinator.start()
        // 1) アクセシビリティ: prompt → 待つ（AX は辿れないので一般ガイドだけ、設定面は開く）
        XCTAssertEqual(h.coordinator.state, .waitingAccessibility)
        XCTAssertEqual(h.permissions.prompts, 1)
        XCTAssertEqual(h.permissions.opened, [.accessibility])
        XCTAssertFalse(h.overlay.guideVisible)
        // 付与を OS API で検知 → success → 次へ
        h.permissions.states[.accessibility] = .granted
        h.coordinator.recheckPermissions()
        XCTAssertTrue(h.overlay.log.contains("avatar:success"))
        // 2) 画面収録: 要求 → 未許可 → 設定面を開いて System Settings を待つ
        XCTAssertEqual(h.coordinator.state, .openingScreenSettings)
        XCTAssertEqual(h.permissions.opened.last, .screenCapture)
        h.settings(running: true)
        h.coordinator.tick()
        XCTAssertEqual(h.coordinator.state, .waitingScreenCapture)
        XCTAssertTrue(h.overlay.guideVisible)
        XCTAssertEqual(h.overlay.guideMessage, PermissionGuideCoordinator.calloutTurnOn)
        XCTAssertEqual(h.observer.started.count, 1)
        XCTAssertEqual(h.observer.observedElements, 0, "検査の木には実要素が無いので要素の監視は登録されない")
        // 付与 → 案内が消え、success
        h.permissions.states[.screenCapture] = .granted
        h.coordinator.handleAXEvent("AXValueChanged")
        XCTAssertFalse(h.overlay.guideVisible)
        // 3) マイク: notDetermined → OS のダイアログ → 許可 → completed → idle
        XCTAssertEqual(h.coordinator.state, .idle)
        XCTAssertEqual(h.permissions.states[.microphone], .granted)
        XCTAssertEqual(h.overlay.visiblePanelCount, 0)
        XCTAssertEqual(h.observer.stops, 1)
    }

    func testDeniedMicrophoneGuidesToSettingsInsteadOfFinishing() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .granted, .microphone: .denied])
        h.coordinator.start()
        XCTAssertEqual(h.coordinator.state, .waitingMicrophone)
        XCTAssertEqual(h.permissions.opened, [.microphone])
        XCTAssertTrue(h.overlay.guideVisible, "マイクの面でも Astra 行を案内する")
        h.permissions.states[.microphone] = .granted
        h.coordinator.tick()
        XCTAssertEqual(h.coordinator.state, .idle)
    }

    func testNotDeterminedMicrophoneRefusedFallsBackToSettings() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .granted, .microphone: .notDetermined])
        h.permissions.microphoneAnswer = false
        h.coordinator.start()
        XCTAssertEqual(h.coordinator.state, .waitingMicrophone)
        XCTAssertEqual(h.permissions.opened, [.microphone])
        XCTAssertEqual(h.overlay.avatarState, .guiding)
    }

    func testRecheckDoesNothingUnlessGranted() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted])
        h.coordinator.start()
        h.coordinator.tick()
        XCTAssertEqual(h.coordinator.state, .waitingScreenCapture)
        h.coordinator.recheckPermissions()
        XCTAssertEqual(h.coordinator.state, .waitingScreenCapture, "付与されていないのに進まない")
    }

    func testSettingsNeverAppearingFails() {
        var t = Date(timeIntervalSince1970: 1000)
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted], settingsRunning: false)
        // now を差し替えるために依存を作り直す
        let p = h.permissions
        var deps = PermissionGuideCoordinator.Dependencies(
            permissions: p, tree: h.tree, makeObserver: { h.observer }, overlay: h.overlay,
            openSettings: { _ in }, settingsPID: { nil })
        deps.successDwell = 0; deps.fallbackInterval = 0; deps.after = { _, b in b() }
        deps.settingsLaunchTimeout = 5
        deps.now = { t }
        let c = PermissionGuideCoordinator(dependencies: deps)
        c.start()
        XCTAssertEqual(c.state, .openingScreenSettings)
        t = t.addingTimeInterval(6)
        c.tick()
        XCTAssertEqual(c.state, .failed("設定画面を開けませんでした"))
        XCTAssertEqual(h.overlay.avatarState, .warning)
        c.stop()
        XCTAssertEqual(c.state, .idle)
    }

    func testStartIsIgnoredWhileRunning() {
        let h = Harness(states: [.accessibility: .granted, .screenCapture: .notDetermined, .microphone: .granted])
        h.coordinator.start()
        let before = h.permissions.opened.count
        h.coordinator.start()
        XCTAssertEqual(h.permissions.opened.count, before)
    }
}
