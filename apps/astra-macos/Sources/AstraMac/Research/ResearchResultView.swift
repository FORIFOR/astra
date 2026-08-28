import SwiftUI

/// §13.2 Research Result: 結論（Executive summary）を優先し、下に source count / confidence /
/// contradiction を出す。Evidence は Inspector で開く（§15 の progressive disclosure）。
struct ResearchResultView: View {
    @Environment(\.colorScheme) private var scheme
    var title: String
    var summaryPoints: [String]
    var sourceCount: Int
    var confidence: String
    var contradictions: Int
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.base) {
            Text(title).font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                .foregroundStyle(Palette.text(dark))
            Text("Executive summary").font(.system(size: TypeScale.microSize, weight: .semibold))
                .foregroundStyle(Palette.muted(dark))
            ForEach(Array(summaryPoints.enumerated()), id: \.offset) { i, p in
                HStack(alignment: .top, spacing: 6) {
                    Text("\(i + 1).").font(.system(size: TypeScale.secondarySize, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                    Text(p).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark))
                }
            }
            EvidenceSummaryView(sourceCount: sourceCount, confidence: confidence,
                                contradictions: contradictions,
                                groups: [])   // L1 は Inspector で展開
                .frame(width: 380)
            HStack(spacing: 12) {
                ForEach(["Evidence", "Continue research", "Share"], id: \.self) { a in
                    Text(a).font(.system(size: TypeScale.secondarySize, weight: .medium)).foregroundStyle(Palette.accent(dark))
                }
            }
        }
        .padding(Space.cardPadding)
        .frame(width: 460, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
        .accessibilityIdentifier("researchResult")
    }
}
