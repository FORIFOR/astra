import AppKit
import UniformTypeIdentifiers
import XCTest
@testable import AstraMac

@MainActor
final class PermissionHelpTests: XCTestCase {
    func testSelectedPermissionDoesNotRequestOtherAccess() {
        let h = Harness(states: [:])
        h.coordinator.guide(.screenCapture)
        XCTAssertEqual(h.permissions.opened, [.screenCapture])
        XCTAssertEqual(h.permissions.prompts, 0)
        XCTAssertEqual(h.permissions.screenRequests, 1)
        h.coordinator.guide(.accessibility)
        XCTAssertEqual(h.permissions.opened, [.screenCapture, .accessibility])
        XCTAssertEqual(h.coordinator.plan.pending, [.accessibility])
        h.coordinator.stop()
    }

    func testMissingMicrophoneDoesNotSendUserToScreenRecording() {
        let h = Harness(states: [.microphone: .denied], tree: settingsTree(withAstra: false, withAdd: false))
        h.coordinator.guide(.microphone)
        XCTAssertEqual(h.overlay.avatarMessage, PermissionGuideCoordinator.messageMicrophoneFallback)
        XCTAssertFalse(h.overlay.avatarMessage.contains("画面収録"))
        XCTAssertNil(h.overlay.applicationToAdd)
        h.coordinator.stop()
    }

    func testAnOnLookingSwitchCannotEstablishPermission() {
        let h = Harness(states: [.accessibility: .notDetermined], tree: settingsTree(astraOn: true))
        h.coordinator.guide(.accessibility)
        h.coordinator.recheckPermissions()
        XCTAssertEqual(h.coordinator.state, .waitingAccessibility)
        XCTAssertFalse(h.overlay.log.contains("avatar:success"))
        h.coordinator.stop()
    }

    func testPreviousSuccessCallbackCannotAdvanceANewGuide() throws {
        let h = Harness(states: [:])
        var callbacks: [() -> Void] = []
        var deps = PermissionGuideCoordinator.Dependencies(
            permissions: h.permissions, tree: h.tree, makeObserver: { h.observer }, overlay: h.overlay,
            openSettings: { h.permissions.opened.append($0) }, settingsPID: { 4242 })
        deps.fallbackInterval = 0
        deps.after = { _, block in callbacks.append(block) }
        let guide = PermissionGuideCoordinator(dependencies: deps)
        guide.guide(.accessibility)
        h.permissions.states[.accessibility] = .granted
        guide.recheckPermissions()
        guide.recheckPermissions()
        XCTAssertEqual(callbacks.count, 1, "repeated permission notifications cannot schedule duplicate transitions")
        // A new pending screen guide should not be advanced by the old success callback.
        guide.guide(.screenCapture)
        let previous = guide.state
        callbacks.first?()
        XCTAssertEqual(guide.state, previous)
        guide.stop()
    }

    func testOnlyExistingAppDirectoriesCanBeOfferedAndPayloadKeepsExactPath() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let app = root.appendingPathComponent("Astra 試験.app")
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertNil(GuideApplication(url: URL(string: "https://example.com/Astra.app")!))
        XCTAssertNil(GuideApplication(url: root.appendingPathComponent("Missing.app")))
        let application = try XCTUnwrap(GuideApplication(url: app))
        XCTAssertEqual(application.name, "Astra 試験")
        let provider = application.itemProvider
        XCTAssertTrue(provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier))
        let item = try await provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier)
        let draggedURL: URL?
        if let url = item as? URL { draggedURL = url }
        else if let data = item as? Data { draggedURL = URL(dataRepresentation: data, relativeTo: nil) }
        else { draggedURL = nil }
        XCTAssertEqual(draggedURL?.standardizedFileURL, application.url)
    }

    func testApplicationMenuHasAWiredPermissionGuide() {
        let app = NSApplication.shared
        let oldMenu = app.mainMenu, oldWindows = app.windowsMenu
        defer { app.mainMenu = oldMenu; app.windowsMenu = oldWindows }
        ApplicationMenu.shared.install()
        let item = app.mainMenu?.items.first?.submenu?.items.first { $0.title == Facts.menuGuidedSetup }
        XCTAssertNotNil(item?.action)
        XCTAssertTrue(item?.target === ApplicationMenu.shared)
    }
}
