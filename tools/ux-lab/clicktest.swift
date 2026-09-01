import AppKit

// 合成クリックが本当に届くかを確かめるための的。
// **Astra を的にしたままでは、道具の不備と製品の欠陥を切り分けられない。**
// ここが押せなければ、その環境では Blind Operator は鍵盤しか使えない。
final class Target: NSView {
    var hit = false
    override func mouseDown(with e: NSEvent) { hit = true; print("CLICK_RECEIVED"); fflush(stdout); NSApp.terminate(nil) }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let win = NSWindow(contentRect: NSRect(x: 600, y: 400, width: 300, height: 200),
                   styleMask: [.titled], backing: .buffered, defer: false)
win.title = "click target"
win.level = .floating
let v = Target(frame: NSRect(x: 0, y: 0, width: 300, height: 200))
v.wantsLayer = true
v.layer?.backgroundColor = NSColor.systemRed.cgColor
win.contentView = v
win.makeKeyAndOrderFront(nil)
print("TARGET \(Int(win.frame.minX)) \(Int(NSScreen.screens[0].frame.height - win.frame.maxY)) 300 200")
fflush(stdout)
DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
    print(v.hit ? "CLICK_RECEIVED" : "NO_CLICK"); fflush(stdout); exit(v.hit ? 0 : 3)
}
app.run()
