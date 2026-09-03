import SwiftUI

/// Esc を「逃げ道の鍵」として受ける。
///
/// `.onExitCommand` は面が first responder を持つときしか届かない。Dock は他アプリを
/// 非活性にしない panel なので、たいてい first responder を持たず、Esc が黙って落ちていた
/// （Journey JA で Listening と結果面が Esc に応えなかった）。⌘Return と同じ
/// key-equivalent の経路で受ければ、焦点が無くても届く。
extension View {
    func escapeKey(_ action: @escaping () -> Void) -> some View {
        background(
            Button("", action: action)
                .keyboardShortcut(.escape, modifiers: [])
                .opacity(0)
                .accessibilityHidden(true)
        )
    }
}
