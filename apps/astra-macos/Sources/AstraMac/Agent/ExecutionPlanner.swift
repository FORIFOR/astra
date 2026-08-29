import Foundation

/// §14 何で実行するかの優先順位。**Vision のクリックは最後の手段**。
///
/// AI にいきなりマウスを動かさせると、失敗が静かで、しかも取り返しがつかない
/// （押した先が違っても分からない）。API があるならそれ、無ければ DOM、無ければ AX、
/// それも無いときだけ画面を見てクリックする。
enum ExecutionRoute: Int, Comparable, CaseIterable {
    case plugin = 1          // Plugin / API
    case applicationAPI = 2  // MCP / Application API
    case browserDOM = 3      // Browser DOM
    case accessibility = 4   // Accessibility API
    case visionUI = 5        // Vision UI Automation（最後の fallback）

    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

    var label: String {
        switch self {
        case .plugin: return "プラグイン"
        case .applicationAPI: return "アプリの API"
        case .browserDOM: return "ブラウザ"
        case .accessibility: return "画面の要素"
        case .visionUI: return "画面を見て操作"
        }
    }

    /// 最後の手段か。UI ではこれだけ扱いを変える（黙って使わない）。
    var isLastResort: Bool { self == .visionUI }
}

enum ExecutionPlanner {
    /// 使える経路のうち**最も上位のもの**を選ぶ。使えるものが無ければ nil。
    static func choose(available: Set<ExecutionRoute>) -> ExecutionRoute? {
        ExecutionRoute.allCases.first { available.contains($0) }
    }

    /// 画面を見て操作する前に、上位の経路が本当に無かったかを確かめる。
    /// 上位が 1 つでも使えるなら、Vision は選ばせない。
    static func mayUseVision(available: Set<ExecutionRoute>) -> Bool {
        guard available.contains(.visionUI) else { return false }
        return available.subtracting([.visionUI]).isEmpty
    }
}
