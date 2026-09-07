import AppKit
import XCTest
@testable import AstraMac

/// Guided Setup の検査用の偽物。AX / 権限 / 窓を差し替えて、状態機械だけを見る。
final class MockPermissions: PermissionProviding {
    var states: [GuidePermission: Permissions.State]
    var microphoneAnswer = true
    var opened: [GuidePermission] = []
    var prompts = 0
    var screenRequests = 0
    init(_ states: [GuidePermission: Permissions.State]) { self.states = states }
    func state(of permission: GuidePermission) -> Permissions.State { states[permission] ?? .notDetermined }
    func promptAccessibility() -> Bool { prompts += 1; return states[.accessibility] == .granted }
    func requestScreenCapture() -> Bool { screenRequests += 1; return states[.screenCapture] == .granted }
    func requestMicrophone(_ done: @escaping (Bool) -> Void) {
        if microphoneAnswer { states[.microphone] = .granted } else { states[.microphone] = .denied }
        done(microphoneAnswer)
    }
    func openSettings(for permission: GuidePermission) { opened.append(permission) }
}

final class MockTree: AXTreeProviding {
    var isTrusted = true
    var pid: pid_t? = 4242
    var tree: AXElementSnapshot?
    var walks = 0
    func pid(ofBundle bundleID: String) -> pid_t? { pid }
    func applicationTree(pid: pid_t, maxDepth: Int, maxNodes: Int) -> AXElementSnapshot? { walks += 1; return tree }
}

final class MockObserver: AXEventObserving {
    var canStart = true
    private(set) var isRunning = false
    var started: [(pid_t, [String])] = []
    var observedElements = 0
    var stops = 0
    private var handler: ((String) -> Void)?
    func start(pid: pid_t, notifications: [String], onEvent: @escaping (String) -> Void) -> Bool {
        guard canStart else { return false }
        started.append((pid, notifications)); handler = onEvent; isRunning = true; return true
    }
    func observe(element: AXUIElement, notifications: [String]) { observedElements += 1 }
    func stop() { if isRunning { stops += 1 }; isRunning = false; handler = nil }
    func fire(_ name: String) { handler?(name) }
}

@MainActor
final class MockOverlay: GuideOverlaying {
    var avatarVisible = false
    var guideVisible = false
    var avatarState: AvatarState = .idle
    var avatarMessage = ""
    var guideMessage: String?
    var guideAnchor: GuideAnchor?
    var log: [String] = []
    var onClose: (() -> Void)?
    func showAvatar(state: AvatarState, message: String, onClose: @escaping () -> Void) {
        avatarVisible = true; avatarState = state; avatarMessage = message; self.onClose = onClose; log.append("avatar:\(state)")
    }
    var avatarAction: String?
    var guidePlacement: GuidePlacement?
    func updateAvatar(state: AvatarState, message: String, action: (title: String, run: () -> Void)?) {
        avatarState = state; avatarMessage = message; avatarAction = action?.title; log.append("avatar:\(state)")
    }
    func showGuide(message: String, at anchor: GuideAnchor, preferred: GuidePlacement) {
        guideVisible = true; guideMessage = message; guideAnchor = anchor; guidePlacement = preferred; log.append("guide")
    }
    func hideGuide() { guideVisible = false; guideMessage = nil; guideAnchor = nil; log.append("hideGuide") }
    func hideAll() { hideGuide(); avatarVisible = false; log.append("hideAll") }
    var visiblePanelCount: Int { (avatarVisible ? 1 : 0) + (guideVisible ? 2 : 0) }
}

/// 検査用の System Settings の木。Astra 行のスイッチが 1 つ。
func settingsTree(astraFrame: CGRect? = CGRect(x: 600, y: 300, width: 40, height: 22), withAstra: Bool = true, withAdd: Bool = true) -> AXElementSnapshot {
    // 実機の形: スイッチは title が空で identifier が `<App>_Toggle`、名前は静的テキストの value。
    var rows: [AXElementSnapshot] = [
        AXElementSnapshot(role: "AXStaticText", identifier: "Zoom_Title", value: "Zoom", axFrame: CGRect(x: 420, y: 260, width: 90, height: 22)),
        AXElementSnapshot(role: "AXCheckBox", subrole: "AXSwitch", identifier: "Zoom_Toggle", value: "1", axFrame: CGRect(x: 600, y: 260, width: 40, height: 22)),
    ]
    if withAstra {
        rows.append(AXElementSnapshot(role: "AXStaticText", identifier: "Astra_Title", value: "Astra", axFrame: CGRect(x: 420, y: 300, width: 90, height: 22)))
        rows.append(AXElementSnapshot(role: "AXCheckBox", subrole: "AXSwitch", identifier: "Astra_Toggle", value: "0", axFrame: astraFrame))
    }
    var buttons: [AXElementSnapshot] = []
    if withAdd { buttons.append(AXElementSnapshot(role: "AXButton", axDescription: "追加", axFrame: CGRect(x: 500, y: 500, width: 24, height: 24))) }
    return AXElementSnapshot(role: "AXApplication", title: "システム設定", children: [
        AXElementSnapshot(role: "AXWindow", title: "画面収録とシステムオーディオ録音", axFrame: CGRect(x: 400, y: 100, width: 700, height: 500), children: [
            AXElementSnapshot(role: "AXStaticText", title: "画面収録とシステムオーディオ録音", axFrame: CGRect(x: 420, y: 120, width: 300, height: 20)),
            AXElementSnapshot(role: "AXGroup", children: rows + buttons),
        ]),
    ])
}

@MainActor
struct Harness {
    let permissions: MockPermissions
    let tree: MockTree
    let observer: MockObserver
    let overlay: MockOverlay
    let coordinator: PermissionGuideCoordinator
    var settingsRunning: Bool

    init(states: [GuidePermission: Permissions.State], settingsRunning: Bool = true, tree: AXElementSnapshot? = settingsTree()) {
        let p = MockPermissions(states)
        let t = MockTree(); t.tree = tree
        let o = MockObserver()
        let v = MockOverlay()
        var running = settingsRunning
        let box = Box(running)
        var deps = PermissionGuideCoordinator.Dependencies(
            permissions: p, tree: t, makeObserver: { o }, overlay: v,
            openSettings: { p.opened.append($0) }, settingsPID: { box.value ? 4242 : nil })
        deps.successDwell = 0
        deps.fallbackInterval = 0          // 検査では timer を使わず tick() を直接呼ぶ
        deps.appNames = ["Astra"]          // 検査は xctest の中で走るので、バンドル名から取らない
        deps.after = { _, block in block() } // 即時
        permissions = p; self.tree = t; observer = o; overlay = v
        coordinator = PermissionGuideCoordinator(dependencies: deps)
        self.settingsRunning = running
        settingsBox = box
        _ = running
    }
    let settingsBox: Box
    func settings(running: Bool) { settingsBox.value = running }
    final class Box { var value: Bool; init(_ v: Bool) { value = v } }
}
