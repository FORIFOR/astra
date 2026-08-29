import SwiftUI

/// ⌥ ⌘ のキー表記。Voice HUD の「長押しで音声入力」に添える。
struct KeyBadge: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 7.5, weight: .medium))
            .foregroundStyle(.white.opacity(0.58))
            .padding(.horizontal, 6)
            .frame(height: 14)
            .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.white.opacity(0.07)))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 0.5))
    }
}
