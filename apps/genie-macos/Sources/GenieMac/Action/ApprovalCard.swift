import SwiftUI

/// §14.1 Consequence card: 外部送信・変更・削除・規制・金融操作の前に「何が起こるか」を明示する。
/// primary は「承認」ではなく**結果**を書く（例: 3件送信する）。対象件数・外部/内部・取り消し可否を出す。
/// カード自体を巨大化させない（長い本文は [内容を確認] のプレビューへ）。
enum ActionRisk: String {
    case reversibleWrite, externalCommit, destructive, regulated, financial
    /// §14 の Risk に応じたラベル。READ は確認不要なのでカード自体を出さない。
    var label: String {
        switch self {
        case .reversibleWrite: return "内部 · 取り消し可"
        case .externalCommit: return "External send"
        case .destructive: return "削除 · 復元情報あり"
        case .regulated: return "規制対象 · 監査記録"
        case .financial: return "金融操作 · 読み上げ確認"
        }
    }
}

struct ApprovalCard: View {
    @Environment(\.colorScheme) private var scheme
    var title: String          // 「3人にメールを送信します」= 結果の文
    var details: [String]      // To: / Subject: など
    var risk: ActionRisk
    var affectedCount: Int
    var primaryLabel: String   // 「3件送信する」= 結果を書く
    private var dark: Bool { scheme == .dark }
    private var accentForRisk: Color {
        switch risk {
        case .destructive, .financial, .regulated: return Palette.danger(dark)
        default: return Palette.accent(dark)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.base) {
            Text(title)
                .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                .foregroundStyle(Palette.text(dark))
            ForEach(details, id: \.self) { d in
                Text(d).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            }
            HStack(spacing: 6) { // 外部/内部・件数・取り消し可否
                Text(risk.label)
                    .font(.system(size: TypeScale.microSize, weight: .medium))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Capsule().fill(accentForRisk.opacity(0.14)))
                    .foregroundStyle(accentForRisk)
                Text("\(affectedCount) 件")
                    .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
            }
            HStack {
                Text("内容を確認")  // 長い本文は preview へ逃がす
                    .font(.system(size: TypeScale.secondarySize, weight: .medium))
                    .foregroundStyle(Palette.accent(dark))
                Spacer()
                Text(primaryLabel)   // primary は結果を書く（「承認」ではない）
                    .font(.system(size: TypeScale.secondarySize, weight: .semibold))
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: Space.radiusSmall, style: .continuous).fill(accentForRisk))
                    .foregroundStyle(.white)
            }
        }
        .padding(Space.cardPadding)
        .frame(width: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
        .accessibilityIdentifier("approvalCard")
    }
}

/// §14 承認後の Action Receipt。Work/Library から追跡できる実行記録。
struct ActionReceiptView: View {
    @Environment(\.colorScheme) private var scheme
    var action: String
    var outcome: String        // success / partial / failed / reversed
    var timestamp: String
    private var dark: Bool { scheme == .dark }
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: outcome == "success" ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(outcome == "success" ? Palette.success(dark) : Palette.warning(dark))
            VStack(alignment: .leading, spacing: 2) {
                Text(action).font(.system(size: TypeScale.secondarySize, weight: .medium)).foregroundStyle(Palette.text(dark))
                Text("\(outcome) · \(timestamp)").font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
            }
            Spacer()
        }
        .padding(Space.cardPadding)
        .frame(width: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
        .accessibilityIdentifier("actionReceipt")
    }
}
