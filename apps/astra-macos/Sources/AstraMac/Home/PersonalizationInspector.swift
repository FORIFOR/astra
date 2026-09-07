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
    private func toggleRow(_ p: PersonalizationProfile) -> some View {
        HStack(spacing: 8) {
            Text(p.inferenceEnabled ? "推測を使っています" : "推測を止めています")
                .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                .foregroundStyle(Palette.text(dark))
            Spacer(minLength: 8)
            Button { store.setInference(!p.inferenceEnabled) } label: {
                Text(p.inferenceEnabled ? Facts.personalizationDisableAll : Facts.personalizationEnableAll)
                    .font(.system(size: S.type(TypeScale.microSize), weight: .medium))
                    .foregroundStyle(p.inferenceEnabled ? Palette.muted(dark) : Palette.accent(dark))
                    .frame(height: 26).padding(.horizontal, 8)
            }
            .buttonStyle(AstraControlStyle(radius: 7, base: 0.05))
            .accessibilityIdentifier("personalizationToggleAll")
        }
    }

    private func group(_ title: String, _ traits: [PersonalizationTrait], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
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

    private func traitRow(_ t: PersonalizationTrait) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(t.label)
                    .font(.system(size: S.type(TypeScale.secondarySize)))
                    .foregroundStyle(t.enabled ? Palette.text(dark) : Palette.muted(dark))
                    .strikethrough(!t.enabled, color: Palette.muted(dark))
                    .lineLimit(2)
                Spacer(minLength: 4)
                statusChip(t.enabled ? t.status.label : "使わない")
            }
            HStack(spacing: 4) {
                if !t.sources.isEmpty {
                    Button {
                        if evidenceOpen.contains(t.key) { evidenceOpen.remove(t.key) } else { evidenceOpen.insert(t.key) }
                    } label: {
                        Text("\(Facts.sourceLabel) \(t.sources.count)")
                            .font(.system(size: S.type(TypeScale.captionSize)))
                            .foregroundStyle(Palette.accent(dark))
                            .frame(height: 22).padding(.horizontal, 6)
                    }
                    .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                }
                Spacer(minLength: 0)
                if t.enabled {
                    if t.status != .confirmed {
                        Button { store.setTrait(t.key, status: .confirmed) } label: {
                            Text(Facts.personalizationConfirm)
                                .font(.system(size: S.type(TypeScale.captionSize), weight: .medium))
                                .foregroundStyle(Palette.accent(dark))
                                .frame(height: 22).padding(.horizontal, 6)
                        }
                        .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                        .accessibilityIdentifier("traitConfirm-\(t.key)")
                    }
                    Button { store.setTrait(t.key, enabled: false) } label: {
                        Text(Facts.personalizationDisableTrait)
                            .font(.system(size: S.type(TypeScale.captionSize)))
                            .foregroundStyle(Palette.muted(dark))
                            .frame(height: 22).padding(.horizontal, 6)
                    }
                    .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                    .accessibilityIdentifier("traitDisable-\(t.key)")
                } else {
                    Button { store.setTrait(t.key, enabled: true) } label: {
                        Text("使う")
                            .font(.system(size: S.type(TypeScale.captionSize), weight: .medium))
                            .foregroundStyle(Palette.accent(dark))
                            .frame(height: 22).padding(.horizontal, 6)
                    }
                    .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                    .accessibilityIdentifier("traitEnable-\(t.key)")
                }
            }
            if evidenceOpen.contains(t.key) {
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
        }
        .padding(.vertical, 6)
        .accessibilityIdentifier("trait-\(t.key)")
    }

    private func statusChip(_ text: String) -> some View {
        Text(text)
            .font(.system(size: S.type(TypeScale.captionSize), weight: .medium))
            .foregroundStyle(Palette.muted(dark))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().stroke(Color.hairline(dark)))
    }
}
