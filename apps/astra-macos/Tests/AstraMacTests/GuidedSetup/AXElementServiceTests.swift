import AppKit
import XCTest
@testable import AstraMac

/// selector の優先順位・未発見 fallback・座標変換・画面端の clamp・マルチディスプレイ。
final class AXElementServiceTests: XCTestCase {
    // MARK: selector

    func testSelectorMatchesOnCombinedConditionsNotJustOneString() {
        let node = AXElementSnapshot(role: "AXCheckBox", title: "Astra", axDescription: "Astra のスイッチ", identifier: "row.astra")
        XCTAssertTrue(AXSelector(role: "AXCheckBox", titleAny: ["Astra"]).matches(node))
        XCTAssertFalse(AXSelector(role: "AXButton", titleAny: ["Astra"]).matches(node), "role が違えば title が合っても当てない")
        XCTAssertTrue(AXSelector(titleAny: ["ast"], titleContains: true).matches(node))
        XCTAssertFalse(AXSelector(titleAny: ["ast"]).matches(node), "完全一致では部分文字列に当てない")
        XCTAssertTrue(AXSelector(descriptionAny: ["switch", "スイッチ"]).matches(node), "日本語と英語の候補を並べられる")
        XCTAssertTrue(AXSelector(identifier: "row.astra").matches(node))
        XCTAssertFalse(AXSelector(identifier: "row.zoom").matches(node))
        XCTAssertFalse(AXSelector().matches(node), "条件の無い selector は何にも当てない")
    }

    func testSelectorsAreTriedInOrderAndTheFirstThatMatchesWins() {
        // 木の先頭に名前の静的テキスト、後ろにスイッチ（実機の並び）。スイッチの selector が先なので、木の順ではなく selector の順で決まる。
        let tree = settingsTree()
        let match = tree.find(SystemSettingsAnchorLocator.astraRowSelectors())
        XCTAssertEqual(match?.node.identifier, "Astra_Toggle")
        XCTAssertEqual(match?.selectorRank, 0)
        // スイッチが無ければ名前の静的テキスト（後ろの selector）に落ちる。
        let noToggle = settingsTree(astraFrame: nil)
        var pruned = noToggle
        pruned.children[0].children[1].children.removeAll { $0.identifier == "Astra_Toggle" }
        let text = pruned.find(SystemSettingsAnchorLocator.astraRowSelectors())
        XCTAssertEqual(text?.node.identifier, "Astra_Title")
        XCTAssertGreaterThan(text!.selectorRank, 0)
        XCTAssertNil(tree.find([AXSelector(role: "AXButton", titleAny: ["nothing"])]))
        // 名前の候補は複数（表示名 / バンドル名）。どれかで当たればよい。
        XCTAssertEqual(tree.find(SystemSettingsAnchorLocator.astraRowSelectors(appNames: ["AstraDbg", "Astra"]))?.node.identifier, "Astra_Toggle")
        XCTAssertNil(tree.find(SystemSettingsAnchorLocator.astraRowSelectors(appNames: ["Other"])))
    }

    func testSelectorMatchesIdentifierListAndValue() {
        let toggle = AXElementSnapshot(role: "AXCheckBox", subrole: "AXSwitch", identifier: "Astra_Toggle", value: "0")
        XCTAssertTrue(AXSelector(role: "AXCheckBox", identifierAny: ["AstraDbg_Toggle", "Astra_Toggle"]).matches(toggle))
        XCTAssertFalse(AXSelector(role: "AXCheckBox", identifierAny: ["Zoom_Toggle"]).matches(toggle))
        let text = AXElementSnapshot(role: "AXStaticText", value: "画面収録とシステムオーディオ録音")
        XCTAssertTrue(AXSelector(role: "AXStaticText", valueAny: ["画面収録"], valueContains: true).matches(text))
        XCTAssertFalse(AXSelector(role: "AXStaticText", valueAny: ["画面収録"]).matches(text))
        XCTAssertNotNil(AXElementSnapshot(children: [text]).find(SystemSettingsAnchorLocator.screenCapturePaneSelectors))
    }

    func testPaneSelectorsCoverJapaneseAndEnglish() {
        let ja = AXElementSnapshot(role: "AXStaticText", title: "画面収録とシステムオーディオ録音")
        let en = AXElementSnapshot(role: "AXStaticText", value: "Screen & System Audio Recording")
        let old = AXElementSnapshot(role: "AXStaticText", title: "Screen Recording")
        for node in [ja, en, old] {
            XCTAssertNotNil(AXElementSnapshot(children: [node]).find(SystemSettingsAnchorLocator.screenCapturePaneSelectors), "\(node.title ?? node.value!)")
        }
    }

    // MARK: locator fallback

    func testLocatorReturnsNothingWhenNotTrustedAndDoesNotWalk() {
        let tree = MockTree(); tree.isTrusted = false; tree.tree = settingsTree()
        let locator = SystemSettingsAnchorLocator(tree: tree, screenFrames: { [CGRect(x: 0, y: 0, width: 1920, height: 1080)] }, primaryHeight: { 1080 })
        let r = locator.locate(.accessibilityElement(bundleID: "x", selectors: SystemSettingsAnchorLocator.astraRowSelectors()))
        XCTAssertNil(r.anchor)
        XCTAssertEqual(r.reason, "accessibility not trusted")
        XCTAssertEqual(tree.walks, 0, "許可が無いときは AX を辿らない")
    }

    func testLocatorReportsWhyWhenTargetIsMissingOrHasNoFrame() {
        let frames = { [CGRect(x: 0, y: 0, width: 1920, height: 1080)] }
        let tree = MockTree(); tree.tree = settingsTree(withAstra: false)
        let locator = SystemSettingsAnchorLocator(tree: tree, screenFrames: frames, primaryHeight: { 1080 })
        let missing = locator.locate(.accessibilityElement(bundleID: "x", selectors: SystemSettingsAnchorLocator.astraRowSelectors()))
        XCTAssertNil(missing.anchor)
        XCTAssertTrue(missing.reason?.hasPrefix("no match") == true)

        tree.tree = settingsTree(astraFrame: nil)
        let noFrame = locator.locate(.accessibilityElement(bundleID: "x", selectors: SystemSettingsAnchorLocator.astraRowSelectors()))
        XCTAssertNil(noFrame.anchor, "位置の無い要素には出さない（推測しない）")
        XCTAssertEqual(noFrame.reason, "match has no frame")

        tree.pid = nil
        XCTAssertEqual(locator.locate(.accessibilityElement(bundleID: "x", selectors: [])).reason, "x not running")
        XCTAssertNil(locator.locate(.screenCorner).anchor)
    }

    func testLocatorConvertsToAppKitCoordinates() {
        let tree = MockTree(); tree.tree = settingsTree(astraFrame: CGRect(x: 600, y: 300, width: 40, height: 22))
        let locator = SystemSettingsAnchorLocator(tree: tree, screenFrames: { [CGRect(x: 0, y: 0, width: 1920, height: 1080)] }, primaryHeight: { 1080 })
        let r = locator.locate(.accessibilityElement(bundleID: "x", selectors: SystemSettingsAnchorLocator.astraRowSelectors()))
        XCTAssertEqual(r.anchor?.rect, CGRect(x: 600, y: 1080 - 300 - 22, width: 40, height: 22))
    }

    // MARK: coordinates

    func testAXToAppKitOnPrimaryDisplay() {
        let r = AXCoordinateConverter.appKitRect(CGRect(x: 100, y: 50, width: 200, height: 30), primaryScreenHeight: 1080)
        XCTAssertEqual(r, CGRect(x: 100, y: 1000, width: 200, height: 30))
    }

    func testAXToAppKitOnDisplayAboveAndLeftOfPrimary() {
        // 主画面の上（AX では y が負）と左（x が負）にある副画面。AppKit では y が主画面の高さを超える。
        let above = AXCoordinateConverter.appKitRect(CGRect(x: 100, y: -500, width: 10, height: 10), primaryScreenHeight: 1080)
        XCTAssertEqual(above, CGRect(x: 100, y: 1570, width: 10, height: 10))
        let left = AXCoordinateConverter.appKitRect(CGRect(x: -1000, y: 200, width: 10, height: 10), primaryScreenHeight: 1080)
        XCTAssertEqual(left, CGRect(x: -1000, y: 870, width: 10, height: 10))
        let screens = [CGRect(x: 0, y: 0, width: 1920, height: 1080), CGRect(x: 0, y: 1080, width: 1920, height: 1080), CGRect(x: -1920, y: 0, width: 1920, height: 1080)]
        XCTAssertEqual(AXCoordinateConverter.screenFrame(containing: above, screenFrames: screens), screens[1])
        XCTAssertEqual(AXCoordinateConverter.screenFrame(containing: left, screenFrames: screens), screens[2])
        XCTAssertNil(AXCoordinateConverter.screenFrame(containing: CGRect(x: 5000, y: 5000, width: 1, height: 1), screenFrames: screens))
    }

    // MARK: callout placement

    func testCalloutPrefersAboveThenFallsBackWhenNoRoom() {
        let bounds = CGRect(x: 0, y: 0, width: 1000, height: 600)
        let size = CGSize(width: 200, height: 40)
        let mid = CalloutPlacer.place(target: CGRect(x: 400, y: 300, width: 40, height: 20), size: size, within: bounds)
        XCTAssertEqual(mid.placement, .above)
        XCTAssertEqual(mid.frame.minY, 320 + CalloutPlacer.gap)
        let top = CalloutPlacer.place(target: CGRect(x: 400, y: 570, width: 40, height: 20), size: size, within: bounds)
        XCTAssertEqual(top.placement, .below)
        // 左上の隅: 上にも下にも左にも収まらない → どこに置いても画面内に clamp される。
        let corner = CalloutPlacer.place(target: CGRect(x: 0, y: 570, width: 40, height: 20), size: size, within: bounds)
        XCTAssertTrue(bounds.contains(corner.frame), "\(corner.frame)")
        let leftEdge = CalloutPlacer.place(target: CGRect(x: 0, y: 300, width: 40, height: 20), size: size, within: bounds, preferred: .left)
        XCTAssertNotEqual(leftEdge.placement, .left, "左に余地が無ければ左には置かない")
        XCTAssertTrue(bounds.contains(leftEdge.frame))
    }

    func testCalloutIsClampedInsideTheScreenWhenNothingFits() {
        let bounds = CGRect(x: 0, y: 0, width: 300, height: 100)
        let size = CGSize(width: 280, height: 60)
        let placed = CalloutPlacer.place(target: CGRect(x: 140, y: 40, width: 20, height: 20), size: size, within: bounds)
        XCTAssertTrue(bounds.contains(placed.frame), "\(placed.frame)")
    }

    func testHighlightFramePadsTheTarget() {
        XCTAssertEqual(CalloutPlacer.highlightFrame(target: CGRect(x: 10, y: 10, width: 20, height: 20)),
                       CGRect(x: 3, y: 3, width: 34, height: 34))
    }

    func testAvatarSitsAtBottomRightInset24() {
        let f = AvatarLayout.frame(size: CGSize(width: 120, height: 80), in: CGRect(x: 0, y: 40, width: 1920, height: 1000))
        XCTAssertEqual(f.maxX, 1920 - 24)
        XCTAssertEqual(f.minY, 40 + 24)
    }
}
