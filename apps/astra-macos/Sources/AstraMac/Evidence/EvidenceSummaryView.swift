import SwiftUI

/// §15 Evidence / Provenance: Evidence Ledger を常時前面に出さず、結論の信頼ラベルから掘る
/// Progressive Disclosure。L0 = source count + confidence + contradiction count、
/// L1 = source groups（Official/Filings/News/Internal）。L2/L3 は inspector で開く。
struct EvidenceGroup: Identifiable { let id = UUID(); let name: String; let count: Int }

struct EvidenceSummaryView: View {
    @Environment(\.colorScheme) private var scheme
    var sourceCount: Int
    var confidence: String        // High / Medium / Low
    var contradictions: Int
    var groups: [EvidenceGroup]   // L1
    private var dark: Bool { scheme == .dark }
    private var confidenceColor: Color {
        switch confidence.lowercased() {
        case "high": return Palette.success(dark)
        case "low": return Palette.warning(dark)
        default: return Palette.muted(dark)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) { // L0
                Text("\(sourceCount) sources")
                    .font(.system(size: TypeScale.secondarySize, weight: .semibold))
                    .foregroundStyle(Palette.text(dark))
                Text("·").foregroundStyle(Palette.muted(dark))
                Text("\(confidence) confidence")
                    .font(.system(size: TypeScale.secondarySize, weight: .medium))
                    .foregroundStyle(confidenceColor)
                if contradictions > 0 {   // 矛盾は隠さない
                    Text("·").foregroundStyle(Palette.muted(dark))
                    Text("Contradictions \(contradictions)")
                        .font(.system(size: TypeScale.secondarySize, weight: .medium))
                        .foregroundStyle(Palette.warning(dark))
                }
            }
            HStack(spacing: 10) { // L1: source groups
                ForEach(groups) { g in
                    Text("\(g.name) \(g.count)")
                        .font(.system(size: TypeScale.microSize))
                        .foregroundStyle(Palette.muted(dark))
                }
            }
            Text("View evidence")   // L2/L3 は inspector へ
                .font(.system(size: TypeScale.secondarySize, weight: .medium))
                .foregroundStyle(Palette.accent(dark))
        }
        .padding(Space.cardPadding)
        .frame(width: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
        .accessibilityIdentifier("evidenceSummary")
    }
}
