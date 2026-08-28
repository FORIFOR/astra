import SwiftUI

/// §6 Work Surface / Task Card: 複雑処理の進捗を「仕事単位」で見せる。Agent orchestration は隠す（§6.1）。
/// step は todo/active/done/retrying。active は source count/elapsed を出す。§6.2: spinner だけにしない、
/// 推定%を乱用しない、waiting approval は混ぜない、失敗は「再試行中」に置換。寸法/色は tokens 由来。
enum WorkStepState { case todo, active, done, retrying, waiting }
struct WorkStep: Identifiable {
    let id = UUID()
    let label: String    // semantic（"競合情報を調査中" 等。ResearchAgent #3 ではない）
    let state: WorkStepState
    var detail: String = ""  // "12 sources" 等
}

struct WorkSurfaceView: View {
    @Environment(\.colorScheme) private var scheme
    var title: String
    var status: String       // "進行中" / "確認待ち" 等
    var steps: [WorkStep]
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.base) {
            HStack {
                Text(title).font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight)).foregroundStyle(Palette.text(dark))
                Spacer()
                Text(status).font(.system(size: TypeScale.microSize, weight: .medium)).foregroundStyle(Palette.accent(dark))
            }
            ForEach(steps) { step in
                HStack(spacing: 10) {
                    glyph(step.state)
                    Text(step.label).font(.system(size: TypeScale.secondarySize))
                        .foregroundStyle(step.state == .todo ? Palette.muted(dark) : Palette.text(dark))
                    Spacer()
                    if !step.detail.isEmpty {
                        Text(step.detail).font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                    }
                }
            }
            HStack { Spacer(); Text("詳しく見る").font(.system(size: TypeScale.secondarySize, weight: .medium)).foregroundStyle(Palette.accent(dark)) }
        }
        .padding(Space.cardPadding)
        .frame(width: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
        .accessibilityIdentifier("workSurface")
    }

    @ViewBuilder private func glyph(_ s: WorkStepState) -> some View {
        switch s {
        case .done: Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.success(dark))
        case .active: Circle().fill(Palette.accent(dark)).frame(width: 8, height: 8)
        case .retrying: Image(systemName: "arrow.clockwise").font(.system(size: 9)).foregroundStyle(Palette.warning(dark))
        case .waiting: Image(systemName: "clock").font(.system(size: 9)).foregroundStyle(Palette.warning(dark))
        case .todo: Circle().stroke(Palette.muted(dark), lineWidth: 1).frame(width: 8, height: 8)
        }
    }
}
