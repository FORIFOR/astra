import SwiftUI

/// Astra が今あなたについて使っている情報。Work Context 仕様 §Personalization。
///
/// 3 段（観測 / 推測 / 確認済み）を隠さない。どの行も [そのとおり] か [この推測を使わない] の
/// **1 操作**で直せる。全体を止めるのも 1 操作。出所は件数で出し、押せば同じ抜粋が見える。
struct PersonalizationInspector: View {
    @ObservedObject private var store = WorkContextStore.shared
    @Environment(\.colorScheme) private var scheme
    @State private var evidenceOpen: Set<String> = []
    private var dark: Bool { scheme == .dark }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(Facts.personalizationTitle)
                    .font(.system(size: S.type(TypeScale.captionSize), weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                if let p = store.profile {
                    toggleRow(p)
                    if p.inferenceEnabled {
                        // 3 段の意味を、印の出る場所で 1 行だけ言う（盲検 d40c313: 「推測」と「観測」の違いが画面に無い）。
                        Text("観測 = 記録から数えたこと · 推測 = そこから Astra が考えたこと · 確認済み = あなたが認めたこと")
                            .font(.system(size: S.type(TypeScale.captionSize)))
                            .foregroundStyle(Palette.muted(dark))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("personalizationLegend")
                        group("働き方", p.workingStyle, empty: "まだ確かめたものはありません。会議や依頼が増えると、ここに提案が出ます。")
                        group("仕事のパターン", p.workPatterns, empty: "まだ十分に読めていません。")
                        group("よく出る人・案件", p.frequentEntities, empty: "まだ読んでいません。")
                    } else {
                        Text("推測を止めています。Astra は、あなたが確認した情報も含めて何も使いません。")
                            .font(.system(size: S.type(TypeScale.microSize)))
                            .foregroundStyle(Palette.muted(dark))
                    }
                } else {
                    Text("まだ何も読んでいません。")
                        .font(.system(size: S.type(TypeScale.microSize)))
                        .foregroundStyle(Palette.muted(dark))
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityIdentifier("personalizationInspector")
    }

    /// 全体の停止。**押した瞬間に効く。**確認を挟まない（戻すのも 1 操作なので）。
    ///
    /// 状態は言葉で言い、操作は作用範囲まで書いた button にする（盲検 1127b32: 全体の切り替えと
    /// 各行の「この推測を使わない」が同じ言葉で並んで作用範囲が読めなかった）。switch は試したが、
    /// 前面でない窓では on でも off の絵になり、撮影と読み手を欺くのでやめた（workcontext gate で state を実測）。
    private func toggleRow(_ p: PersonalizationProfile) -> some View {
        HStack(spacing: 8) {
            Text(p.inferenceEnabled ? "すべての推測を使っています" : "すべての推測を止めています")
                .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                .foregroundStyle(Palette.text(dark))
            Spacer(minLength: 8)
            actionButton(p.inferenceEnabled ? "すべて止める" : "すべて使う", accent: !p.inferenceEnabled) {
                store.setInference(!p.inferenceEnabled)
            }
            .accessibilityIdentifier("personalizationToggleAll")
        }
    }

    private func group(_ title: String, _ traits: [PersonalizationTrait], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: S.type(TypeScale.microSize), weight: .semibold))
                .foregroundStyle(Palette.muted(dark))
                .tracking(0.3)
                .padding(.top, 6)
            if traits.isEmpty {
                Text(empty)
                    .font(.system(size: S.type(TypeScale.captionSize)))
                    .foregroundStyle(Palette.muted(dark))
            }
            ForEach(traits) { t in traitRow(t) }
        }
    }

    /// 1 件の推測。**どの行も同じ形**: 1 行目 = 言葉 … [出所 N] 状態、2 行目 = [そのとおり] [この推測を使わない]。
    ///
    /// 盲検（a752c92 → af507b2）で 3 judge が揃って指摘した順に直した: 確認済みの行だけ形が違う → 同じ 2 段、
    /// 操作が文字リンクに見える → 縁つきの button、出所と操作の関係 → 出所は言葉の行に、操作は操作の行に、
    /// 狭い Panel で 3 つの button が詰まる → 操作は 2 つだけの行にして幅を使う、
    /// 灰色の「そのとおり」は押せないのか済みなのか読めない → 確認済みは**塗った**選択状態（押した結果が残る形）。
    private func traitRow(_ t: PersonalizationTrait) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(t.label)
                    .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                    .foregroundStyle(t.enabled ? Palette.text(dark) : Palette.muted(dark))
                    .strikethrough(!t.enabled, color: Palette.muted(dark))
                    .lineLimit(2)
                Spacer(minLength: 4)
                if !t.sources.isEmpty {
                    actionButton("\(Facts.sourceLabel) \(t.sources.count)", accent: false) {
                        if evidenceOpen.contains(t.key) { evidenceOpen.remove(t.key) } else { evidenceOpen.insert(t.key) }
                    }
                    .accessibilityIdentifier("traitEvidence-\(t.key)")
                }
                statusChip(t.enabled ? t.status.label : "使わない")
            }
            HStack(spacing: 8) {
                if t.enabled {
                    // 確認済みは塗りで残す（選択状態）。押しても変わらないが、灰色で「押せない」に見せない。
                    let confirmed = t.status == .confirmed
                    Button { if !confirmed { store.setTrait(t.key, status: .confirmed) } } label: {
                        Text(Facts.personalizationConfirm)
                            .font(.system(size: S.type(TypeScale.microSize), weight: .medium))
                            .foregroundStyle(confirmed ? Color.white : Palette.accent(dark))
                            .frame(height: 26).padding(.horizontal, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(confirmed ? Palette.accent(dark) : Color.clear))
                    }
                    .buttonStyle(AstraControlStyle(radius: 6, base: confirmed ? 0.0 : 0.05, filled: !confirmed))
                    .accessibilityIdentifier("traitConfirm-\(t.key)")
                    actionButton(Facts.personalizationDisableTrait, accent: false) { store.setTrait(t.key, enabled: false) }
                        .accessibilityIdentifier("traitDisable-\(t.key)")
                } else {
                    actionButton("使う", accent: true) { store.setTrait(t.key, enabled: true) }
                        .accessibilityIdentifier("traitEnable-\(t.key)")
                }
                Spacer(minLength: 0)
            }
            if evidenceOpen.contains(t.key) {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(t.sources.prefix(4)) { s in
                        HStack(spacing: 6) {
                            Text(WorkFormat.sourceName(s.source))
                                .font(.system(size: S.type(TypeScale.captionSize), weight: .semibold))
                                .foregroundStyle(Palette.muted(dark))
                            Text(s.label)
                                .font(.system(size: S.type(TypeScale.captionSize)))
                                .foregroundStyle(Palette.text(dark))
                                .lineLimit(1)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.hairline(dark)))
        .accessibilityIdentifier("trait-\(t.key)")
    }

    /// 縁のある小さな button。文字リンクにしない（押せることが見えるように）。
    private func actionButton(_ title: String, accent: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: S.type(TypeScale.microSize), weight: .medium))
                .foregroundStyle(accent ? Palette.accent(dark) : Palette.text(dark))
                .frame(height: 26).padding(.horizontal, 10)
        }
        .buttonStyle(AstraControlStyle(radius: 6, base: 0.05))
    }

    private func statusChip(_ text: String) -> some View {
        Text(text)
            .font(.system(size: S.type(TypeScale.captionSize), weight: .medium))
            .foregroundStyle(Palette.muted(dark))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().stroke(Color.hairline(dark)))
    }
}
