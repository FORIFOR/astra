import SwiftUI

/// 押せるものを「押せる」と分からせる 3 状態を **1 か所** に集約する。
///
/// 実機の撮影で分かったこと: これまで hover / focus / pressed が
/// アプリ全体で **0 箇所**だった。静止画では整って見えても、触ると何も返らない
/// —— Apple の静かな UI は「反応が無い」ことではない。
///
/// 差分量・押し込み量・リングの太さは View に書かず
/// `shared/design/tokens.json` の `interaction` から生成した `Metrics` を使う。
struct AstraControlStyle: ButtonStyle {
    var radius: CGFloat = 9
    /// 通常時の地の濃さ。選択中は少し濃くする、などの呼び分けに使う。
    var base: Double = 0.045
    /// 地を敷かない操作（Dock アイコンなど）は false。hover/pressed は前景で表す。
    var filled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        Surface(configuration: configuration, radius: radius, base: base, filled: filled)
    }

    private struct Surface: View {
        let configuration: Configuration
        let radius: CGFloat
        let base: Double
        let filled: Bool

        @Environment(\.colorScheme) private var scheme
        @State private var hovering = false
        @FocusState private var focused: Bool
        /// 撮影用の上書き。通常は全部 false なので描画に影響しない。
        @ObservedObject private var preview = InteractionPreview.shared
        /// リングはキーボードで動かし始めてからだけ見せる（macOS の作法）。
        @ObservedObject private var keyNav = KeyboardNavigation.shared

        var body: some View {
            let dark = scheme == .dark
            let hot = hovering || preview.hover
            let down = configuration.isPressed || preview.pressed
            let ring = (focused && keyNav.active) || preview.focus
            let amount = base + (down ? Metrics.pressedDelta : hot ? Metrics.hoverDelta : 0)

            configuration.label
                .opacity(filled ? 1 : (down ? 0.55 : hot ? 0.8 : 1))
                .background {
                    if filled {
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(Color.subtleFill(dark, amount))
                    } else if hot || down {
                        // 地を敷かない操作でも、触れたことは面で返す。
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(Color.white.opacity(down ? 0.22 : 0.13))
                    }
                }
                .overlay {
                    // キーボード移動中の現在位置。色だけに頼らず太いリングで示す。
                    RoundedRectangle(cornerRadius: radius + 1, style: .continuous)
                        .strokeBorder(Color.astraAccent(dark).opacity(ring ? 0.95 : 0),
                                      lineWidth: Metrics.focusRing)
                        .padding(-1)
                }
                .scaleEffect(down ? Metrics.pressedScale : 1)
                .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .focusable(true)
                .focused($focused)
                // 標準の focus effect は窓を開いた瞬間から出てしまう。
                // リングは自前の 1 本（keyNav.active のときだけ）に統一する。
                .focusEffectDisabled()
                .onHover { hovering = $0 }
                .animation(.easeOut(duration: Motion.hoverMs), value: hot)
                .animation(.easeOut(duration: Motion.hoverMs), value: down)
        }
    }
}

/// スクリーンショットで hover / focus / pressed を撮るための上書き。
///
/// 実機の Visual Gate はマウスを動かせない（動かしても再現しない）。
/// **状態そのものを差し込んで撮り、neutral との画素差で「見えている」ことを検査**する。
/// 通常起動では常に false。`--selftest states` からのみ立つ。
final class InteractionPreview: ObservableObject {
    static let shared = InteractionPreview()
    @Published var hover = false
    @Published var pressed = false
    @Published var focus = false

    func reset() {
        hover = false
        pressed = false
        focus = false
    }
}
