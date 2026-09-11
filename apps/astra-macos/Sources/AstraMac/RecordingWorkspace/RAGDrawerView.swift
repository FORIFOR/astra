import SwiftUI
import AstraCore

/// 下から伸びる RAG コンテキスト。閉じているときは「+ RAG」だけ。
struct RAGDrawerView: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                // 何の面かを日本語で言う（"RAG Context" は中身を説明していない）。
                Label("AI が見ている資料", systemImage: "books.vertical")
                    .font(.system(size: TypeScale.microSize, weight: .semibold))
                Spacer()
                Button { state.ragOpen = false } label: { Image(systemName: "xmark") }
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .frame(height: 38)
            Divider()
            HStack(spacing: 8) {
                ragSource("ファイル", "doc") { state.pickFileContext() }
                ragSource("Gmail", "envelope")
                ragSource("Drive", "externaldrive")
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 8)
            if state.ragResults.isEmpty {
                Text("関連する文脈はまだありません。")
                    .font(.system(size: TypeScale.captionSize)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14).padding(.bottom, 12)
            } else {
                VStack(spacing: 6) {
                    ForEach(state.ragResults.prefix(3)) { item in
                        rankedRow(item)
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 12)
            }
        }
        .background(Color.cardSurface(dark))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.hairline(dark)))
        // 影は無し。作業面の中で伸びる区画であって、浮いた別の面ではない
        // （DESIGN.md §2: 面の中の区画は 0）。
        .accessibilityIdentifier("ragDrawer")
    }

    /// core が並べ替えた 1 行。score と reason（根拠）を出す（§8「根拠を出す」）。
    private func rankedRow(_ item: RankedContext) -> some View {
        HStack(spacing: 8) {
            Image(systemName: sourceIcon(item.source)).font(.system(size: 11))
                .foregroundStyle(.secondary).frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(.system(size: TypeScale.microSize, weight: .medium)).lineLimit(1)
                // 出所を先に言う。文字起こしと同じ文が「資料」として並ぶ理由が、出所無しでは読めない（盲検 3/3）。
                Text("\(sourceName(item.source)) · \(item.reason)")
                    .font(.system(size: TypeScale.captionSize)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            // 生の 0.45 は読み手にとって意味が無い。強さは棒で見せ、理由は左の 1 行に任せる。
            Capsule().fill(Color.subtleFill(dark, 0.06))
                .frame(width: 44, height: 4)
                .overlay(alignment: .leading) {
                    Capsule().fill(Color.astraAccent(dark))
                        .frame(width: max(4, 44 * min(1, max(0, item.score))), height: 4)
                }
                .accessibilityLabel("関連の強さ \(Int(item.score * 100)) パーセント")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sourceName(_ s: ContextSource) -> String {
        switch s {
        case .meeting: return "この会議の発言"
        case .library: return "ライブラリ"
        case .message: return "選択中の文"
        case .web: return "Web"
        }
    }

    private func sourceIcon(_ s: ContextSource) -> String {
        switch s {
        case .meeting: return "waveform"
        case .library: return "books.vertical"
        case .message: return "envelope"
        case .web: return "globe"
        }
    }

    private func ragSource(_ title: String, _ icon: String, action: @escaping () -> Void = {}) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(title)
            }
            .font(.system(size: TypeScale.microSize, weight: .medium))
            .padding(.horizontal, 11)
            .frame(height: 28)
            .background(Capsule().fill(Color.black.opacity(0.05)))
        }
        .buttonStyle(.plain)
    }
}
