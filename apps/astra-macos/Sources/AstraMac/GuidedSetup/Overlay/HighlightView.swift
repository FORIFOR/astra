import SwiftUI

/// 対象を囲む角丸のアウトライン。塗らない（下の文字を隠さない）。
struct HighlightView: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(Palette.accent(scheme == .dark), lineWidth: 2.5)
            .padding(2)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
