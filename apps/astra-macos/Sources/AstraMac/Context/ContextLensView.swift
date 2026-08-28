import SwiftUI

/// §5 Context Lens: 「Astra が今回何を参照しているか」を確認できる B2B trust surface。
/// §5.1 の分類（Current/Entity/Schedule/Internal/External/Policy）で表示。§5.2: source ごとに remove 可、
/// REGULATED/CONFIDENTIAL は badge、"Why this?" は理由を一段だけ。アクセス可能な全データ一覧ではない。
struct ContextItem: Identifiable {
    let id = UUID()
    let category: String   // §5.1
    let text: String
    var sensitive: Bool = false
}

struct ContextLensView: View {
    @Environment(\.colorScheme) private var scheme
    var items: [ContextItem]
    private var dark: Bool { scheme == .dark }
    private let order = ["Current", "Entity", "Schedule", "Internal", "External", "Policy"]

    var body: some View {
        VStack(alignment: .leading, spacing: Space.base) {
            HStack {
                Text("Context").font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                    .foregroundStyle(Palette.text(dark))
                Spacer()
                Text("Why this?").font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.accent(dark))
            }
            ForEach(order.filter { cat in items.contains { $0.category == cat } }, id: \.self) { cat in
                Text(cat).font(.system(size: TypeScale.microSize, weight: .semibold)).foregroundStyle(Palette.muted(dark))
                ForEach(items.filter { $0.category == cat }) { item in
                    HStack(spacing: 8) {
                        if item.sensitive { // §5.2 REGULATED/CONFIDENTIAL は明示
                            Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(Palette.warning(dark))
                        }
                        Text(item.text).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark))
                        Spacer()
                        Image(systemName: "xmark").font(.system(size: 8)).foregroundStyle(Palette.muted(dark)) // remove
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Palette.muted(dark).opacity(0.10)))
                }
            }
        }
        .padding(Space.cardPadding)
        .frame(width: 320, alignment: .leading) // §7.1 inspector 320px
        .background(Palette.surface(dark))
        .overlay(Rectangle().frame(width: 1).foregroundStyle(Palette.border(dark)), alignment: .leading)
        .accessibilityIdentifier("contextLens")
    }
}
