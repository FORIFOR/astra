import SwiftUI

/// ⌥ ⌘ のキー表記。Voice HUD の「長押しで音声入力」に添える。
struct KeyBadge: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 8, weight: .medium))
            .foregroundStyle(.white.opacity(0.5))
            .padding(.horizontal, 6)
            .frame(height: 14)
            .background(Capsule().fill(.white.opacity(0.07)))
            .overlay(Capsule().stroke(.white.opacity(0.1), lineWidth: 0.5))
    }
}
