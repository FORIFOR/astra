import SwiftUI

/// Dock の地。**画面の外観にかかわらず暗いガラス**にする。
///
/// メニューバーと同じ帯にいるものなので、明るい壁紙でも暗い壁紙でも同じ見え方に
/// 落ち着く方がよい。白基調のまま出すと、明るい壁紙では境界が消え、
/// 暗い壁紙では白い板が浮いてしまう。
///
/// ただし真っ黒な板にはしない。素材を透かした上に黒を重ね、縁を髪の毛ほどの線で締める。
struct DockSurface: View {
    var body: some View {
        let shape = AstraDockShape()
        ZStack {
            // 影は**実体のある形**から落とす。
            // material に直接 .shadow を掛けると、素材には alpha の型が無いので
            // 影が面の外形ではなく**矩形**で出る（実機で角の外に灰色の帯が見えた）。
            shape
                .fill(Color.black.opacity(0.62))
                .shadow(color: .black.opacity(0.38), radius: 16, y: 6)
            // 素材は上に重ねて、形で切る。
            shape
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
                .opacity(0.55)
            shape.stroke(Color.white.opacity(0.12), lineWidth: 0.5)
        }
        // 上辺の内側にだけ薄い明かりを置くと、面に厚みが出る。
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.10))
                .frame(height: 0.5)
                .padding(.horizontal, Metrics.hudTopRadius)
        }
    }
}

/// Dock の中で使う小さな見出し。地が暗いので、色は暗色側で読む。
struct DockLabel: View {
    let text: String
    /// 意味のある見出し（危険度など）は色を持たせる。既定は控えめ。
    var tint: Color?
    var body: some View {
        Text(text)
            .font(.system(size: Metrics.dockLabelSize, weight: .medium))
            .foregroundStyle(tint ?? Palette.muted(true))
            .textCase(.uppercase)
            .tracking(0.4)
    }
}
