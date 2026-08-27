import AppKit
import Carbon.HIToolbox

/// グローバルの音声ショートカット。どのアプリが前面でも Astra を起こす。
///
/// **Carbon の RegisterEventHotKey を使う**（Accessibility 権限が要らない）。
/// CGEventTap は全キーを覗くので Accessibility(TCC) が要るが、ここは「1 つの
/// ホットキーを OS に登録して押下だけ受け取る」ので TCC 無しで動く。正本 §3
/// 「Global voice shortcut」。既定は ⌥Space（Option+Space）。
///
/// live の押下受信は署名済み .app 上でユーザーが実際に押して確かめるが、
/// **登録が成立すること自体は headless で検証できる**（`--selftest shortcut`）。
@MainActor
final class GlobalShortcut {
    static let shared = GlobalShortcut()

    /// 既定のキー（⌥Space）。keyCode 49 = Space。
    struct Combo {
        var keyCode: UInt32 = UInt32(kVK_Space)
        var modifiers: UInt32 = UInt32(optionKey)
    }

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var onFire: (() -> Void)?
    /// signature 'ASTR' / id 1。押下イベントの照合に使う。
    private let hotKeyID = EventHotKeyID(signature: OSType(0x41535452), id: 1)

    /// 登録する。成功すれば true。押されると `handler` が MainActor で呼ばれる。
    @discardableResult
    func register(_ combo: Combo = Combo(), handler: @escaping () -> Void) -> Bool {
        unregister()
        onFire = handler

        var spec = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let userData else { return noErr }
                var fired = EventHotKeyID()
                GetEventParameter(
                    event, EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID), nil,
                    MemoryLayout<EventHotKeyID>.size, nil, &fired
                )
                let this = Unmanaged<GlobalShortcut>.fromOpaque(userData).takeUnretainedValue()
                if fired.signature == this.hotKeyID.signature, fired.id == this.hotKeyID.id {
                    DispatchQueue.main.async { this.onFire?() }
                }
                return noErr
            },
            1, &spec, selfPtr, &eventHandler
        )
        guard installStatus == noErr else { return false }

        let registerStatus = RegisterEventHotKey(
            combo.keyCode, combo.modifiers, hotKeyID,
            GetApplicationEventTarget(), 0, &hotKeyRef
        )
        return registerStatus == noErr && hotKeyRef != nil
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let eventHandler {
            RemoveEventHandler(eventHandler)
            self.eventHandler = nil
        }
        onFire = nil
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
