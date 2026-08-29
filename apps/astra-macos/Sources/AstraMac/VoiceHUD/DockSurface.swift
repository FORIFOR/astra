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
        shape
            // 背後をぼかす window 効果は使わない。
            // `NSVisualEffectView`（behind-window）も SwiftUI の `Material` も、
            // 合成が **ビューの矩形**で行われるため、外形で切っても角の外に
            // 灰色の帯が残る（影を外しても残ったので素材側が原因と分かった）。
            // Dock は黒い面なので、半透明の黒で塗れば壁紙も薄く透けるし、
            // 形どおりに切れて影も外形に沿う。
            .fill(Color.black.opacity(0.80))
            .overlay(shape.stroke(Color.white.opacity(0.14), lineWidth: 0.5))
            // 上辺の内側にだけ薄い明かりを置くと、面に厚みが出る。
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.white.opacity(0.10))
                    .frame(height: 0.5)
                    .padding(.horizontal, Metrics.hudTopRadius)
            }
            // 影は SwiftUI では掛けない。**窓の影**（`hasShadow`）に任せる。
            // SwiftUI の `.shadow` は、素材やレイヤを含む合成の上では
            // 外形ではなくレイヤの**矩形**から落ちる（差分を測ると角の外が −0.05 暗かった）。
            // 窓の影なら window server がアルファをなぞるので、外形どおりに落ちる。
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
