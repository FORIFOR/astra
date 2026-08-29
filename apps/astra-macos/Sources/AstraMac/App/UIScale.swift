import SwiftUI

/// §10 Interface Size。Compact / Comfortable / Large。
///
/// **Window 全体を transform で拡大しない。** それをすると文字がぼやけ、
/// 1px の罫線が太くなり、影が伸びる。ここは design token に係数をかけて、
/// 寸法・余白・文字を「それぞれの単位で」大きくする。
@MainActor
final class UIScale: ObservableObject {
    static let shared = UIScale()

    enum Size: String, CaseIterable, Identifiable {
        case compact, comfortable, large
        var id: String { rawValue }
        var title: String {
            switch self {
            case .compact: return "Compact"
            case .comfortable: return "Comfortable"
            case .large: return "Large"
            }
        }
        /// 文字の係数。寸法より控えめにする（文字だけ極端に大きいと崩れる）。
        var type: CGFloat {
            switch self {
            case .compact: return 0.90
            case .comfortable: return 1.0
            case .large: return 1.15
            }
        }
        /// 面・余白・操作の係数。
        var metric: CGFloat {
            switch self {
            case .compact: return 0.92
            case .comfortable: return 1.0
            case .large: return 1.18
            }
        }
    }

    private static let key = "astra.uiScale"

    @Published private(set) var size: Size = Size(rawValue: UserDefaults.standard.string(forKey: "astra.uiScale") ?? "") ?? .comfortable

    func set(_ size: Size) {
        guard self.size != size else { return }
        self.size = size
        UserDefaults.standard.set(size.rawValue, forKey: Self.key)
    }

    /// 文字寸法へ。
    static func type(_ base: CGFloat) -> CGFloat { (base * shared.size.type).rounded() }
    /// 面・余白・操作の寸法へ。
    static func metric(_ base: CGFloat) -> CGFloat { (base * shared.size.metric).rounded() }
}

/// トークンを scale 済みで読むための入口。
/// View からは `S.type(TypeScale.bodySize)` のように使う。
@MainActor
enum S {
    static func type(_ base: CGFloat) -> CGFloat { UIScale.type(base) }
    static func metric(_ base: CGFloat) -> CGFloat { UIScale.metric(base) }
}
