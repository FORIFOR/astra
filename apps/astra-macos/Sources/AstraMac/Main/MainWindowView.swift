import SwiftUI
import AstraCore

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

/// 実バックエンドから Apps/Library を core 経由で取る（Tauri を介さない）。dev サインインで検証可能。
@MainActor
final class MainData: ObservableObject {
    @Published var apps: [String] = []
    @Published var library: [String] = []
    @Published var connected = false
    private let base = ProcessInfo.processInfo.environment["ASTRA_GATEWAY_URL"] ?? "http://127.0.0.1:3000"

    func load() {
        guard AstraCoreBridge.reachable(base) else { return }
        Task.detached { [base] in
            do {
                let tokens = try AstraCoreBridge.devSignIn(base, email: "main-\(getpid())@astra.local", displayName: "Astra")
                let apps = (try? AstraCoreBridge.pluginCatalog(base, accessToken: tokens.accessToken)) ?? []
                let library = (try? AstraCoreBridge.library(base, accessToken: tokens.accessToken)) ?? []
                await MainActor.run {
                    self.apps = apps; self.library = library; self.connected = true
                    // サインインを録音側にも渡す（AI 操作/翻訳/実会議が使えるようになる）。
                    RecordingWorkspaceState.shared.configureBackend(base: base, token: tokens.accessToken)
                    RecordingRuntime.shared.configureBackend(base: base, accessToken: tokens.accessToken)
                    // サインインしたので、前回落ちた録音があれば gateway へ送って片付ける（§3 recovery）。
                    let recovered = RecoveryState.shared.recoverAll()
                    if recovered > 0 { NSLog("astra: recovered %llu bytes of crashed recordings", recovered) }
                }
            } catch {
                NSLog("main data load failed: \(error)")
            }
        }
    }
}

/// 4 タブの native シェル。Windows 版は同じ構成を NavigationView + Mica で作る（設計共通・実装別）。
struct MainWindowView: View {
    @State private var section: MainSection = .home
    @StateObject private var data = MainData()

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
            case .home: HomePane(recent: data.library)
            case .agents: AgentsPane(apps: data.apps)
            case .library: LibraryPane(titles: data.library)
            case .apps: AppsPane(apps: data.apps)
            }
        }
        .frame(minWidth: 900, minHeight: 560)
        .onAppear { data.load() }
    }
}

private struct HomePane: View {
    let recent: [String]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("こんにちは").font(.system(size: 22, weight: .semibold))
                RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .textBackgroundColor))
                    .frame(height: 44)
                    .overlay(HStack { Text("何を終わらせますか？").foregroundStyle(.secondary); Spacer() }.padding(.horizontal, 12))
                Text("最近の成果物").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                if recent.isEmpty {
                    Text("まだ成果物はありません。").font(.system(size: 12)).foregroundStyle(.secondary)
                } else {
                    ForEach(recent, id: \.self) { t in
                        HStack { Text(t); Spacer(); Text("資料").foregroundStyle(.secondary) }
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
                    }
                }
                Spacer()
            }.padding(24)
        }.navigationTitle("Home")
    }
}

private struct AgentsPane: View {
    let apps: [String]
    var body: some View {
        let agents = apps.isEmpty ? ["Research Agent", "Meeting Agent", "Sales CRM"] : apps
        return List(agents, id: \.self) { a in Label(a, systemImage: "sparkles") }
            .navigationTitle("AI Agents")
    }
}

private struct LibraryPane: View {
    let titles: [String]
    var body: some View {
        let items = titles.isEmpty ? ["（まだありません）"] : titles
        return ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, t in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t).font(.system(size: 13, weight: .semibold))
                        Text("資料").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)))
                }
            }.padding(20)
        }.navigationTitle("Library")
    }
}

private struct AppsPane: View {
    let apps: [String]
    @ObservedObject private var connectors = ConnectorState.shared
    var body: some View {
        let apps = self.apps.isEmpty ? ["Gmail", "Google Calendar", "Finder"] : self.apps
        return ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                ForEach(apps, id: \.self) { a in
                    let connectable = connectors.canConnect(a)
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 7).fill(Color.astraAccent.opacity(0.85))
                            .frame(width: 27, height: 27)
                            .overlay(Text(String(a.prefix(1))).font(.system(size: 12, weight: .bold)).foregroundStyle(.white))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(a).font(.system(size: 12, weight: .semibold))
                            if ConnectorState.provider(for: a) != nil && !connectable {
                                Text("接続には client_id の設定が必要").font(.system(size: 9)).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        // 設定済みのものだけ接続開始できる（繋げないものを繋いだつもりにさせない）。
                        Toggle("", isOn: Binding(
                            get: { connectors.connected.contains(a) },
                            set: { on in if on { _ = connectors.connect(a) } else { connectors.connected.remove(a) } }
                        )).labelsHidden().controlSize(.small).disabled(!connectable)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)))
                }
            }.padding(20)
        }.navigationTitle("Apps")
    }
}
