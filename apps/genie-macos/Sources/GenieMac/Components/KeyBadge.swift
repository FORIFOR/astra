import SwiftUI

/// ⌥ ⌘ のキー表記。Voice HUD の「長押しで音声入力」に添える。
struct KeyBadge: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 7.5, weight: .medium))
            .foregroundStyle(Palette.muted(dark))
            .padding(.horizontal, 6)
            .frame(height: 14)
            .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Color.subtleFill(dark, 0.05)))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(Color.hairline(dark), lineWidth: 0.5))
    }
}
