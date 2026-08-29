import SwiftUI

/// Task Dock の下に出る勧誘。Dock 本体は巨大化させない（§13）。
struct AppDiscoveryView: View {
    let suggestion: AppSuggestion
    @ObservedObject private var state = VoiceHUDState.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(.white.opacity(0.10))
                    .frame(width: 22, height: 22)
                    .overlay(
                        Text(String(suggestion.displayName.prefix(1)))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.85)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(suggestion.displayName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                    Text("Astra に接続しますか")
                        .font(.system(size: 9))
                        .foregroundStyle(.white.opacity(0.55))
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                Button("後で") { state.dismissSuggestion() }
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.62))
                    .frame(height: 26).padding(.horizontal, 10)
                    .buttonStyle(AstraControlStyle(radius: 7, filled: false))
                    .accessibilityIdentifier("discoveryLater")
                Button("追加") { _ = ConnectorState.shared.connect(suggestion.id) }
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(height: 26).padding(.horizontal, 12)
                    .buttonStyle(AstraControlStyle(radius: 7, filled: false))
                    .accessibilityIdentifier("discoveryAdd")
            }
        }
        .padding(12)
        .frame(width: Metrics.discoveryWidth, height: Metrics.discoveryHeight)
        .background(DockPanelSurface())
        .accessibilityIdentifier("appDiscovery")
    }
}

/// Dock をクリックしたときだけ開く機能。通常時の Dock には並べない（§12）。
struct QuickActionsView: View {
    @ObservedObject private var state = VoiceHUDState.shared

    private struct Action: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let run: () -> Void
    }

    private var actions: [Action] {
        [
            Action(icon: "square.dashed", title: "取り込む") { state.mode = .idle },
            Action(icon: "sparkles", title: "聞く") { state.mode = .listening },
            Action(icon: "record.circle", title: "録音") {
                state.mode = .enteringRecording
                WindowCoordinator.shared.toggleRecording()
            },
            Action(icon: "magnifyingglass", title: "探す") { state.mode = .idle },
        ]
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(actions) { a in
                Button {
                    a.run()
                    WindowCoordinator.shared.syncDockPanels()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: a.icon).font(.system(size: 13))
                        Text(a.title).font(.system(size: 9))
                    }
                    .foregroundStyle(.white.opacity(0.72))
                    .frame(width: 66, height: 44)   // §16 hit area
                }
                .buttonStyle(AstraControlStyle(radius: 8, filled: false))
                .accessibilityIdentifier("quick-\(a.title)")
            }
        }
        .padding(.horizontal, 8)
        .frame(width: Metrics.quickActionsWidth, height: Metrics.quickActionsHeight)
        .background(DockPanelSurface())
        .accessibilityIdentifier("quickActions")
    }
}

/// 第二 Panel 共通の面。Dock と同じ言語（native vibrancy + 黒 + 白の細い縁）。
private struct DockPanelSurface: View {
    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
    }
    var body: some View {
        shape
            .fill(Color.black.opacity(0.92))
            .background(VisualEffectView(material: .hudWindow).clipShape(shape))
            .overlay(shape.stroke(.white.opacity(0.08), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.35), radius: 16, y: 6)
    }
}
