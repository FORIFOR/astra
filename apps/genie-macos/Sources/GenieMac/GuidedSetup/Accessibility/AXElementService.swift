import AppKit
import ApplicationServices

/// AX 木を写す口。実装は AXUIElement を辿る。検査では手で組んだ木を返す偽物に差し替える。
protocol AXTreeProviding: AnyObject {
    /// アクセシビリティ許可があるか（prompt を出さない）。無ければ探索しない。
    var isTrusted: Bool { get }
    /// bundle id のアプリの pid。走っていなければ nil。
    func pid(ofBundle bundleID: String) -> pid_t?
    /// pid のアプリの AX 木。深さと節数に上限を設ける（System Settings は大きい）。
    func applicationTree(pid: pid_t, maxDepth: Int, maxNodes: Int) -> AXElementSnapshot?
}

/// AXUIElement を辿って `AXElementSnapshot` に写す。children / role / title / description / identifier /
/// position / size を読む。**許可が無ければ何も読まない**（`AXIsProcessTrusted()` は prompt を出さずに読める）。
final class AXElementService: AXTreeProviding {
    static let shared = AXElementService()

    var isTrusted: Bool { AXIsProcessTrusted() }

    func pid(ofBundle bundleID: String) -> pid_t? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first?.processIdentifier
    }

    func applicationTree(pid: pid_t, maxDepth: Int = 14, maxNodes: Int = 6000) -> AXElementSnapshot? {
        guard isTrusted else { return nil }
        let app = AXUIElementCreateApplication(pid)
        var budget = maxNodes
        return snapshot(app, depth: 0, maxDepth: maxDepth, budget: &budget)
    }

    /// 1 要素の属性を読む（子は辿らない）。追従で位置を取り直すときに使う。
    func snapshot(of element: AXUIElement) -> AXElementSnapshot {
        var budget = 1
        return snapshot(element, depth: 0, maxDepth: 0, budget: &budget)
    }

    // MARK: - 内部

    private func snapshot(_ element: AXUIElement, depth: Int, maxDepth: Int, budget: inout Int) -> AXElementSnapshot {
        budget -= 1
        var node = AXElementSnapshot(
            role: string(element, kAXRoleAttribute),
            subrole: string(element, kAXSubroleAttribute),
            title: string(element, kAXTitleAttribute),
            axDescription: string(element, kAXDescriptionAttribute),
            identifier: string(element, kAXIdentifierAttribute),
            value: valueString(element),
            axFrame: frame(of: element),
            children: [],
            element: element)
        guard depth < maxDepth, budget > 0 else { return node }
        var childrenRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else { return node }
        for child in children {
            if budget <= 0 { break }
            node.children.append(snapshot(child, depth: depth + 1, maxDepth: maxDepth, budget: &budget))
        }
        return node
    }

    private func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success else { return nil }
        if let s = ref as? String { return s.isEmpty ? nil : s }
        return nil
    }

    private func valueString(_ element: AXUIElement) -> String? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &ref) == .success, let v = ref else { return nil }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    private func frame(of element: AXUIElement) -> CGRect? {
        var pRef: CFTypeRef?, sRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &pRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sRef) == .success,
              let p = pRef, let s = sRef,
              CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        guard size.width > 0, size.height > 0 else { return nil }
        return CGRect(origin: point, size: size)
    }
}
