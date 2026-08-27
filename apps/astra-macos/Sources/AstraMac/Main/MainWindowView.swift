import SwiftUI

enum MainSection: String, CaseIterable, Identifiable {
    case home, agents, library, apps
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: return "Home"
        case .agents: return "AI Agents"
        case .library: return "Library"
        case .apps: return "Apps"
        }
    }
    var icon: String {
        switch self {
        case .home: return "house"
        case .agents: return "sparkles"
        case .library: return "books.vertical"
        case .apps: return "square.grid.2x2"
        }
    }
}

/// 4 タブの native シェル。Windows 版は同じ構成を NavigationView + Mica で作る（設計共通・実装別）。
struct MainWindowView: View {
    @State private var section: MainSection = .home

    var body: some View {
        NavigationSplitView {
            List(MainSection.allCases, selection: $section) { s in
                Label(s.title, systemImage: s.icon).tag(s)
            }
            .navigationSplitViewColumnWidth(min: 176, ideal: 200, max: 240)
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 8) {
                    Circle().fill(Color.astraAccent.opacity(0.2)).frame(width: 22, height: 22)
                        .overlay(Text("U").font(.system(size: 10, weight: .semibold)))
                    Text("ui-check").font(.system(size: 11))
                    Spacer()
                }.padding(10)
            }
        } detail: {
            switch section {
            case .home: HomePane()
            case .agents: AgentsPane()
            case .library: LibraryPane()
            case .apps: AppsPane()
            }
        }
        .frame(minWidth: 900, minHeight: 560)
    }
}

private struct HomePane: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("こんにちは、ui-check さん").font(.system(size: 22, weight: .semibold))
                RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .textBackgroundColor))
                    .frame(height: 44)
                    .overlay(HStack { Text("何を終わらせますか？").foregroundStyle(.secondary); Spacer() }.padding(.horizontal, 12))
                Text("最近の成果物").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                ForEach(["Echo result", "A社 商談 議事録"], id: \.self) { t in
                    HStack { Text(t); Spacer(); Text("資料").foregroundStyle(.secondary) }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
                }
                Spacer()
            }.padding(24)
        }.navigationTitle("Home")
    }
}

private struct AgentsPane: View {
    private let agents = ["Research Agent", "Meeting Agent", "Sales CRM", "Stock Research"]
    var body: some View {
        List(agents, id: \.self) { a in
            Label(a, systemImage: "sparkles")
        }.navigationTitle("AI Agents")
    }
}

private struct LibraryPane: View {
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
                ForEach(0..<6) { i in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Echo result").font(.system(size: 13, weight: .semibold))
                        Text("資料 · 2026/8/27").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)))
                    .tag(i)
                }
            }.padding(20)
        }.navigationTitle("Library")
    }
}

private struct AppsPane: View {
    private let apps = ["Gmail", "Google Calendar", "Finder", "Slack", "Notion", "Linear"]
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                ForEach(apps, id: \.self) { a in
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 7).fill(Color.astraAccent.opacity(0.85))
                            .frame(width: 27, height: 27)
                            .overlay(Text(String(a.prefix(1))).font(.system(size: 12, weight: .bold)).foregroundStyle(.white))
                        Text(a).font(.system(size: 12, weight: .semibold))
                        Spacer()
                        Toggle("", isOn: .constant(false)).labelsHidden().controlSize(.small)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)))
                }
            }.padding(20)
        }.navigationTitle("Apps")
    }
}
