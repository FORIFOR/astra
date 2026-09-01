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
    // **source を nil にすると押下が届かない。** 実際、合成クリックでデスクトップを
    // 押しても Finder が前面にならず、「Astra がクリックを無視する」と読み違えた。
    // hidSystemState の source を使い、clickState も明示する。
    let p = pt(2)
    let src = CGEventSource(stateID: .hidSystemState)
    func send(_ type: CGEventType) {
        guard let e = CGEvent(mouseEventSource: src, mouseType: type,
                              mouseCursorPosition: p, mouseButton: .left) else { return }
        e.setIntegerValueField(.mouseEventClickState, value: 1)
        e.post(tap: .cgSessionEventTap)
    }
    send(.mouseMoved); usleep(120_000)
    send(.leftMouseDown); usleep(90_000)
    send(.leftMouseUp)
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
case "type":
    // 文字を打つ口が無かったため、訂正の途中で止まっていた（道具の不備）。
    let text = a.dropFirst(2).joined(separator: " ")
    let src = CGEventSource(stateID: .hidSystemState)
    for ch in text.unicodeScalars {
        var u = UniChar(ch.value)
        guard ch.value <= 0xFFFF else { continue }
        for down in [true, false] {
            if let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down) {
                e.keyboardSetUnicodeString(stringLength: 1, unicodeString: &u)
                e.post(tap: .cghidEventTap)
            }
        }
        usleep(12_000)
    }
default:
    print("usage: uxin click|move <x> <y> | key <code> [opt|cmd|shift] | type <text> | pos"); exit(2)
}
