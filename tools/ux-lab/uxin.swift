import AppKit
import CoreGraphics

// 画面へ実際に入力を送る。Blind Operator の「手」。
// 使い方: uxin click <x> <y> / uxin move <x> <y> / uxin key <keycode> [opt|cmd|shift]
//         uxin pos
let a = CommandLine.arguments
func pt(_ i: Int) -> CGPoint { CGPoint(x: Double(a[i]) ?? 0, y: Double(a[i+1]) ?? 0) }

switch a.count > 1 ? a[1] : "" {
case "pos":
    let p = NSEvent.mouseLocation
    // NSEvent は左下原点。CG は左上原点。
    let h = NSScreen.screens.first?.frame.height ?? 0
    print(String(format: "%.0f %.0f", p.x, h - p.y))
case "move":
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: pt(2), mouseButton: .left)?.post(tap: .cghidEventTap)
case "click":
    let p = pt(2)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(60_000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(40_000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
case "key":
    let code = CGKeyCode(UInt16(a[2]) ?? 0)
    var flags: CGEventFlags = []
    for m in a.dropFirst(3) {
        if m == "opt" { flags.insert(.maskAlternate) }
        if m == "cmd" { flags.insert(.maskCommand) }
        if m == "shift" { flags.insert(.maskShift) }
    }
    let src = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)
    down?.flags = flags; up?.flags = flags
    down?.post(tap: .cghidEventTap); usleep(40_000); up?.post(tap: .cghidEventTap)
default:
    print("usage: uxin click|move <x> <y> | key <code> [opt|cmd|shift] | pos"); exit(2)
}
