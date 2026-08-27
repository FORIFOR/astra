import Foundation

/// §17 Visual Regression 用。経過時間・波形・transcript・位置を固定して、毎回同じ画面を描く。
enum DemoMode: Equatable {
    case none
    case hudListening
    case hudThinking
    case recording
    case recordingRAG

    static func fromArguments(_ args: [String]) -> DemoMode {
        guard let index = args.firstIndex(of: "--demo"), index + 1 < args.count else {
            return .none
        }
        switch args[index + 1] {
        case "hud-listening": return .hudListening
        case "hud-thinking": return .hudThinking
        case "recording": return .recording
        case "recording-rag": return .recordingRAG
        default: return .none
        }
    }
}
