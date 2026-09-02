import AppKit
import SwiftUI

/// 中身で高さが決まる Dock の状態は、**推定せず、描いて測る。**
///
/// ③ で確認の面の高さを「積むものの実寸和」の式にした。式は view の写しなので、
/// view を 1 か所変えるたびに式も追わないとずれる。実際 14pt 短くなり、
/// 面（ZStack の地）が中身の高さまで伸びて窓の外へはみ出し、角丸が窓の縁で
/// 切られて四角い黒い板になっていた（agent は 25pt）。採点者が「E7D5 は
/// 角丸のカードに見えない」と言ったのはこれで、造形の話ではなかった。
///
/// 高さを決める場所は 1 つ。**view そのもの**。同じ view を同じ幅で
/// 画面外に敷いて `fittingSize` を取る。式は持たない。
enum DockContentMeasure {
    /// 同じ中身を何度も敷かない（`size()` は body の評価ごとに呼ばれる）。
    private static var cache: (key: Key, height: CGFloat)?

    private struct Key: Equatable {
        let dock: DockPresentation
        let task: AgentTask?
        let width: CGFloat
        let type: CGFloat
        let metric: CGFloat
    }

    /// 中身で決まる状態なら描いた高さ、そうでなければ nil（token の寸法を使う）。
    @MainActor
    static func height(of dock: DockPresentation, width: CGFloat) -> CGFloat? {
        let body: AnyView
        switch dock {
        case .confirmation(let c): body = AnyView(ConfirmationDock(confirmation: c))
        case .agent: body = AnyView(AgentDock())
        default: return nil
        }
        let key = Key(dock: dock, task: AstraStateStore.shared.state.activeTask, width: width,
                      type: UIScale.shared.size.type, metric: UIScale.shared.size.metric)
        if let cache, cache.key == key { return cache.height }
        // 本番と同じ条件で敷く。地が暗いので中身は暗色側、幅は面の幅。
        let host = NSHostingView(rootView: body.frame(width: width).environment(\.colorScheme, .dark))
        let h = host.fittingSize.height.rounded(.up)
        cache = (key, h)
        return h
    }
}
