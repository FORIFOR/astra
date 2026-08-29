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
                Label("RAG Context", systemImage: "books.vertical")
                    .font(.system(size: 12, weight: .semibold))
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
                    .font(.system(size: 11)).foregroundStyle(.secondary)
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
        .shadow(color: .black.opacity(0.1), radius: 16, y: 6)
        .accessibilityIdentifier("ragDrawer")
    }

    /// core が並べ替えた 1 行。score と reason（根拠）を出す（§8「根拠を出す」）。
    private func rankedRow(_ item: RankedContext) -> some View {
        HStack(spacing: 8) {
            Image(systemName: sourceIcon(item.source)).font(.system(size: 11))
                .foregroundStyle(.secondary).frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(.system(size: 11, weight: .medium)).lineLimit(1)
                Text(item.reason).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Text(String(format: "%.2f", item.score))
                .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 11)
            .frame(height: 28)
            .background(Capsule().fill(Color.black.opacity(0.05)))
        }
        .buttonStyle(.plain)
    }
}
