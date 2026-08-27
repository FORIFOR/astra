import SwiftUI

/// 下から伸びる RAG コンテキスト。閉じているときは「+ RAG」だけ。
struct RAGDrawerView: View {
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
                ragSource("ファイル", "doc")
                ragSource("Gmail", "envelope")
                ragSource("Drive", "externaldrive")
                Spacer()
            }
            .padding(14)
        }
        .frame(height: 120)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.08)))
        .shadow(color: .black.opacity(0.1), radius: 16, y: 6)
        .accessibilityIdentifier("ragDrawer")
    }

    private func ragSource(_ title: String, _ icon: String) -> some View {
        Button {} label: {
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
