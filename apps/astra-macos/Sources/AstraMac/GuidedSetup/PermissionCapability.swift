import Foundation

/// Product language for the three independently enabled Mac capabilities.
extension GuidePermission {
    static let capabilityOrder: [GuidePermission] = [.microphone, .screenCapture, .accessibility]

    var capabilityTitle: String {
        switch self {
        case .microphone: return "Astraと話す"
        case .screenCapture: return "画面を理解する"
        case .accessibility: return "Macを操作する"
        }
    }

    var symbol: String {
        switch self {
        case .microphone: return "mic"
        case .screenCapture: return "viewfinder"
        case .accessibility: return "cursorarrow.click"
        }
    }

    var systemPermissionName: String {
        switch self {
        case .microphone: return Facts.permissionMicrophone
        case .screenCapture: return Facts.permissionScreenRecording
        case .accessibility: return Facts.permissionAccessibility
        }
    }

    var explanation: String {
        switch self {
        case .microphone: return "声で、Astraに頼めます\n話している間だけマイクを使います。文字でも引き続き依頼できます。"
        case .screenCapture: return "画面を見ながら、一緒に作業できます\n必要なときに画面を読み取ります。まずは1枚だけ、このMacで試せます。"
        case .accessibility: return "アプリの操作を手伝えます\n入力欄に文字を書き込んだり、ボタンを操作できます。まずは練習用の入力欄で試せます。"
        }
    }

    var enableTitle: String {
        switch self {
        case .microphone: return "マイクを許可する"
        case .screenCapture: return "画面アクセスを許可する"
        case .accessibility: return "Macの操作を許可する"
        }
    }

    var readyMessage: String {
        switch self {
        case .microphone: return "声で頼む準備ができました\n試すとマイクが開きます。聞き終えると閉じます。"
        case .screenCapture: return "画面を見る準備ができました\n試すと画面を1枚読み取ります。外部には送りません。"
        case .accessibility: return "Macを操作する準備ができました\n練習用の入力欄で、文字の書き込みを試せます。"
        }
    }
}

struct PermissionGuidePurpose {
    let explanation: String
    let readyMessage: String
    var continueTitle = "試してみる"

    static let recording = PermissionGuidePurpose(
        explanation: "録音するにはマイクが必要です\n録音を開始すると声を取り込みます。許可したあとに開始を選べます。",
        readyMessage: "録音を始める準備ができました\n開始を押すと、この録音の音声を取り込みます。",
        continueTitle: "録音を開始")
}
