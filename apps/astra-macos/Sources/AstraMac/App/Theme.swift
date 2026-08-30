import SwiftUI

// 寸法（Metrics / Motion）は shared/design/tokens.json から生成: GeneratedMetrics.swift。

extension Color {
    /// Astra のアクセント。§17.1 の生成トークン（tokens.json → Palette）を単一正として使う。
    /// 直書きの色は持たない（spec: UI を各 OS へ直書きせず tokens から生成する）。
    static let astraAccent = Palette.accentLight
    /// テーマ対応のアクセント（Light/Dark で切替）。
    static func astraAccent(_ dark: Bool) -> Color { Palette.accent(dark) }
    static let recordingRed = Color(red: 1.0, green: 0.27, blue: 0.23)
    /// 録音面の地。dark では白のままだと本文（.primary=白）が読めなくなるため、
    /// §17 の canvas トークンへ寄せて外観に追従させる。
    static func workspaceSurface(_ dark: Bool) -> Color {
        dark ? Palette.canvasDark : Color(nsColor: NSColor(calibratedWhite: 0.975, alpha: 0.96))
    }
    /// カード面（文字起こし / RAG / AI 結果）。
    static func cardSurface(_ dark: Bool) -> Color {
        dark ? Palette.surfaceDark : .white
    }
    /// 罫線。dark では黒ではなく白を薄く乗せる。
    static func hairline(_ dark: Bool) -> Color {
        dark ? Color.white.opacity(0.12) : Color.black.opacity(0.08)
    }
    /// 面にうっすら乗せる塗り（選択中・二次ボタンの地）。
    static func subtleFill(_ dark: Bool, _ amount: Double = 0.05) -> Color {
        // 0 は「敷かない」。dark のときだけ下駄を履かせていたので、地を敷かないつもりの
        // ボタンが白 3% の板として浮いていた。Start recording の ⌄ が、カードの中に
        // もう一枚の角丸として見えていたのがこれ（light では透明なので気づけなかった）。
        guard amount > 0 else { return .clear }
        return dark ? Color.white.opacity(amount + 0.03) : Color.black.opacity(amount)
    }
}
