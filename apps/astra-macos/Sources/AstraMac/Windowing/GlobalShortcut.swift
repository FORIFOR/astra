import AppKit
import Carbon.HIToolbox

/// グローバルの音声ショートカット。どのアプリが前面でも Astra を起こす。正本 §3
/// 「Global voice shortcut / Global shortcut: CGEventTap」。既定は ⌥Space（Option+Space）。
///
/// **CGEventTap を使う**（正本指定の API）。セッションレベルの tap はハードウェアの押下も、
/// `CGEvent.post` された合成イベントも受け取る。これにより「登録」だけでなく
/// **「押下を受信して発火する」経路そのものを headless で実測できる**
/// （`--selftest shortcut` が合成 ⌥Space を注入して発火を確認する）。
/// tap は一致キーだけ consume（return nil）し、他のキーは素通しする。
///
/// CGEventTap は Accessibility(TCC) を要するが、Astra は §3「Accessibility integration」で
/// 既に AX 権限を使うため追加コストは無い。tap 生成に失敗（未許可）したら false を返し、
/// 呼び出し側が権限付与を促せる。
@MainActor
final class GlobalShortcut {
    static let shared = GlobalShortcut()

    /// 既定のキー（⌥Space）。keyCode 49 = Space。modifiers は Carbon ビット（label 表示と共用）。
    struct Combo {
        var keyCode: UInt32 = UInt32(kVK_Space)
        var modifiers: UInt32 = UInt32(optionKey)
    }

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var onFire: (() -> Void)?
    private var combo = Combo()

    /// 登録する。tap 生成に成功すれば true。押されると `handler` が MainActor で呼ばれる。
    @discardableResult
    func register(_ combo: Combo = Combo(), handler: @escaping () -> Void) -> Bool {
        unregister()
        onFire = handler
        self.combo = combo

        let mask = (1 << CGEventType.keyDown.rawValue)
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,                 // active: 一致キーを consume できる
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, userData in
                guard let userData else { return Unmanaged.passUnretained(event) }
                let this = Unmanaged<GlobalShortcut>.fromOpaque(userData).takeUnretainedValue()
                if type == .keyDown {
                    let kc = event.getIntegerValueField(.keyboardEventKeycode)
                    if GlobalShortcut.matches(combo: this.combo, keyCode: kc, flags: event.flags) {
                        DispatchQueue.main.async { this.onFire?() }
                        return nil                // 自分のホットキーは飲み込む（他アプリへ流さない）
                    }
                }
                return Unmanaged.passUnretained(event)  // それ以外は素通し
            },
            userInfo: selfPtr
        ) else {
            return false   // tap 生成失敗 = Accessibility 未許可
        }

        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        eventTap = tap
        runLoopSource = src
        return true
    }

    func unregister() {
        if let eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: false)
        }
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
            self.runLoopSource = nil
        }
        eventTap = nil
        onFire = nil
    }

    /// Combo（Carbon modifier ビット）と実イベントの (keyCode, flags) が一致するか。
    /// 4 修飾（⌘⌥⌃⇧）だけを比較し、CapsLock/Fn 等は無視する。純関数（テスト可能）。
    static func matches(combo: Combo, keyCode: Int64, flags: CGEventFlags) -> Bool {
        guard keyCode == Int64(combo.keyCode) else { return false }
        var need: CGEventFlags = []
        if combo.modifiers & UInt32(cmdKey) != 0 { need.insert(.maskCommand) }
        if combo.modifiers & UInt32(optionKey) != 0 { need.insert(.maskAlternate) }
        if combo.modifiers & UInt32(controlKey) != 0 { need.insert(.maskControl) }
        if combo.modifiers & UInt32(shiftKey) != 0 { need.insert(.maskShift) }
        let compareMask: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift]
        return flags.intersection(compareMask) == need
    }

    /// 人が読めるラベル（Settings/HUD 表示用）。
    static func label(_ combo: Combo = Combo()) -> String {
        var parts = ""
        if combo.modifiers & UInt32(cmdKey) != 0 { parts += "⌘" }
        if combo.modifiers & UInt32(optionKey) != 0 { parts += "⌥" }
        if combo.modifiers & UInt32(controlKey) != 0 { parts += "⌃" }
        if combo.modifiers & UInt32(shiftKey) != 0 { parts += "⇧" }
        let key = combo.keyCode == UInt32(kVK_Space) ? "Space" : "key\(combo.keyCode)"
        return parts + key
    }
}
