import SwiftUI

/// §8 Home: KPI dashboard ではなく「今必要な仕事への入口」。greeting + intent、Attention 最大3、Active work、Recent。
/// 寸法/色/余白は tokens 由来（Palette/TypeScale/Space）。KPI は常設しない（§8.1）。
struct HomeAttention: Identifiable { let id = UUID(); let kind: String; let title: String; let action: String }
struct HomeWork: Identifiable { let id = UUID(); let title: String; let meta: String }

struct HomeView: View {
    @Environment(\.colorScheme) private var scheme
    var greeting: String = "Good morning"
    var attention: [HomeAttention] = []
    var active: [HomeWork] = []
    private var dark: Bool { scheme == .dark }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.largePadding) {
                Text(greeting)
                    .font(.system(size: TypeScale.pageTitleSize, weight: TypeScale.pageTitleWeight))
                    .foregroundStyle(Palette.text(dark))

                // universal intent（§8: 中央の入力。KPI ではなく依頼の入口）
                HStack(spacing: 10) {
                    Text("何を終わらせますか？")
                        .font(.system(size: TypeScale.bodySize))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "mic").foregroundStyle(Palette.muted(dark))
                }
                .padding(.horizontal, Space.cardPadding).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous)
                    .fill(Palette.surface(dark)).overlay(RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))

                if !attention.isEmpty {
                    section("Attention")
                    ForEach(attention.prefix(3)) { a in // §8.1 最大3件
                        row(icon: "exclamationmark.circle", accent: Palette.warning(dark),
                            title: a.title, sub: a.kind, action: a.action)
                    }
                }
                if attention.isEmpty && active.isEmpty {
                    // §8.1: 空状態では機能説明を並べず、頼み方を 1 行だけ示す。
                    VStack(spacing: 6) {
                        Text("今日はまだ何もありません。")
                            .font(.system(size: TypeScale.bodySize))
                            .foregroundStyle(Palette.text(dark))
                        Text("面倒なことを 1 つ頼んでください。")
                            .font(.system(size: TypeScale.secondarySize))
                            .foregroundStyle(Palette.muted(dark))
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, Space.largePadding)
                }
                if !active.isEmpty {
                    section("Active work")
                    ForEach(active) { w in
                        row(icon: "circle.fill", accent: Palette.accent(dark), title: w.title, sub: w.meta, action: nil)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(Space.largePadding)
        }
        .background(Palette.canvas(dark))
        .accessibilityIdentifier("homeView")
    }

    private func section(_ t: String) -> some View {
        Text(t).font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
            .foregroundStyle(Palette.muted(dark))
    }
    private func row(icon: String, accent: Color, title: String, sub: String, action: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight)).foregroundStyle(Palette.text(dark))
                Text(sub).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            }
            Spacer()
            if let action { Text(action).font(.system(size: TypeScale.secondarySize, weight: .medium)).foregroundStyle(Palette.accent(dark)) }
        }
        .padding(Space.cardPadding)
        .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
    }
}
