import AppKit

/// §26 初回に一気に権限を要求しない。**その機能を使う瞬間に、その機能の分だけ**要求する。
///
/// 起動直後にマイク・画面・アクセシビリティを並べて聞くと、
/// 何に使うのか分からないまま全部断られる。逆に「声を使おうとした瞬間にマイクだけ」なら、
/// 何のための許可かが自明になる。
///
/// ここは **どの機能がどの許可を要るか** の一覧でもある。増やすときはここに足す。
@MainActor
enum PermissionCenter {
    enum Capability: String, CaseIterable {
        case voice          // 声で頼む
        case screenAsk      // 画面について聞く
        case control        // この Mac を操作する（dictation / グローバル操作）
        case meeting        // 会議を録る

        /// この機能に**本当に要る**もの。ここに書いていないものは要求しない。
        var required: [Kind] {
            switch self {
            case .voice: return [.microphone]
            case .screenAsk: return [.screenRecording]
            case .control: return [.accessibility]
            case .meeting: return [.microphone, .screenRecording]
            }
        }

        var reason: String {
            switch self {
            case .voice: return "声で頼むにはマイクが要ります。"
            case .screenAsk: return "画面について答えるには画面の読み取りが要ります。"
            case .control: return "入力欄へ書き込むにはアクセシビリティが要ります。"
            case .meeting: return "会議を録るにはマイクと、相手の音声のために画面の読み取りが要ります。"
            }
        }
    }

    enum Kind: String {
        case microphone, screenRecording, accessibility

        var state: Permissions.State {
            switch self {
            case .microphone: return Permissions.microphone
            case .screenRecording: return Permissions.screenRecording
            case .accessibility: return Permissions.accessibility
            }
        }

        var label: String {
            switch self {
            case .microphone: return "マイク"
            case .screenRecording: return "画面の読み取り"
            case .accessibility: return "アクセシビリティ"
            }
        }
    }

    /// 足りていない許可だけを返す。全部揃っていれば空。
    static func missing(for capability: Capability) -> [Kind] {
        capability.required.filter { $0.state != .granted }
    }

    /// その機能に要るものだけを要求する。要求したものを返す（何も要らなければ空）。
    ///
    /// **他の機能の許可は絶対に触らない** —— それをやると「初回に一括」に戻る。
    @discardableResult
    static func request(_ capability: Capability) -> [Kind] {
        let needed = missing(for: capability)
        for kind in needed {
            switch kind {
            case .microphone: Permissions.requestMicrophone { _ in }
            case .screenRecording: Permissions.requestScreenRecording()
            case .accessibility: Permissions.openAccessibilitySettings()
            }
        }
        return needed
    }

    /// 使える状態か。使えないときは理由を返す（黙って何もしないのが一番困る）。
    static func check(_ capability: Capability) -> (ok: Bool, reason: String?) {
        let needed = missing(for: capability)
        guard !needed.isEmpty else { return (true, nil) }
        let names = needed.map(\.label).joined(separator: "と")
        return (false, "\(capability.reason)（不足: \(names)）")
    }
}
