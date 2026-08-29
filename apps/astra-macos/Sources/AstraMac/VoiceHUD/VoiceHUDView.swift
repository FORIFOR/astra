import SwiftUI

/// Task Dock。画面最上端から生える 2 層構造。
///
/// ```text
/// Outer shell   VoiceDockShellShape + native vibrancy + 黒 92%
///     ↓
/// Inner HUD     わずかに明るいガラスのカプセル（322×35）
///     ↓
/// Content       状態に応じた 1 行だけ
/// ```
///
/// 大事なのは**状態が変わっても Dock が暴れない**こと。idle も listening も thinking も
/// 内側カプセルの寸法は同じで、入れ替わるのは中身だけ。Window サイズは一切変えない。
/// ブランドロゴや機能ボタンは常設しない（機能はクリックで Quick Actions に開く）。
struct VoiceTaskDockView: View {
    @StateObject private var state = VoiceHUDState.shared

    var body: some View {
        ZStack(alignment: .top) {
            outerShell
            innerHUD.offset(y: Metrics.hudInnerOffset)
        }
        .frame(width: Metrics.hudWidth, height: Metrics.hudHeight)
        .contentShape(VoiceDockShellShape())
        .onTapGesture { state.toggleQuickActions() }
        .accessibilityIdentifier("voiceHUD")
        .accessibilityLabel("Astra Task Dock")
    }

    /// 外形。native vibrancy の上に黒を重ね、縁は白を薄く 1 本。
    private var outerShell: some View {
        VoiceDockShellShape()
            .fill(Color.black.opacity(0.92))
            .background(VisualEffectView(material: .hudWindow).clipShape(VoiceDockShellShape()))
            .overlay(VoiceDockShellShape().stroke(.white.opacity(0.07), lineWidth: 0.5))
            .accessibilityIdentifier("dockShell")
    }

    /// 内側の細い HUD。ここだけが中身を持ち、寸法は状態によらず固定。
    private var innerHUD: some View {
        HStack(spacing: 5) {
            content
        }
        .frame(width: Metrics.hudInnerWidth, height: Metrics.hudInnerHeight)
        .background(innerShape.fill(.white.opacity(0.045)))
        .overlay(innerShape.stroke(.white.opacity(0.07), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.28), radius: 9, y: 3)
        .animation(.easeOut(duration: Motion.hoverMs), value: state.mode)
        .accessibilityIdentifier("dockInner")
    }

    private var innerShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Metrics.hudInnerRadius, style: .continuous)
    }

    @ViewBuilder private var content: some View {
        switch state.mode {
        case .idle:
            // 通常時はこれだけ。密度も静けさも VoiceOS に合わせる。
            KeyBadge("option")
            KeyBadge("command")
            Text("長押しで音声入力")
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.48))

        case .listening:
            AstraOrb(active: true)
            MiniWaveform()
            Text("聞いています…")
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.62))

        case .transcribing(let text):
            AstraOrb(active: true)
            Text(text.isEmpty ? "…" : text)
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(1)
                .truncationMode(.head)

        case .thinking:
            Image(systemName: "sparkles").font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.62))
            Text("考えています…")
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.62))

        case .contextualApp(let suggestion):
            // 勧誘そのものは下の Panel に出る。Dock 側は静かに印だけ。
            AstraOrb(active: false)
            Text("\(suggestion.displayName) を見つけました")
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.62))

        case .quickActions:
            AstraOrb(active: true)
            Text("何をしますか")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.white.opacity(0.78))

        case .enteringRecording:
            Circle().fill(Color.recordingRed)
                .frame(width: Metrics.hudOrbSize, height: Metrics.hudOrbSize)
            Text("録音を始めます…")
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.72))
        }
    }
}

/// 旧名。既存の呼び出し（selftest / WindowCoordinator）を壊さないための別名。
typealias VoiceHUDView = VoiceTaskDockView
