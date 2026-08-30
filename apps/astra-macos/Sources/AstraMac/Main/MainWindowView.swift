import SwiftUI
import AstraCore

enum MainSection: String, CaseIterable, Identifiable {
    case home, tasks, meetings, library, agents, plugins
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: return "Home"
        case .tasks: return "Tasks"
        case .meetings: return "Meetings"
        case .library: return "Library"
        case .agents: return "Agents"
        case .plugins: return "Plugins"
        }
    }
    var icon: String {
        switch self {
        case .home: return "house"
        case .tasks: return "checklist"
        case .meetings: return "waveform"
        case .library: return "books.vertical"
        case .agents: return "sparkles"
        case .plugins: return "square.grid.2x2"
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
                    VoiceHUDState.shared.configureBackend(base: base, token: tokens.accessToken)
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

/// Main Window のナビ状態。Visual Gate の撮影や外部導線から切り替えるため共有にする。
@MainActor
final class MainNav: ObservableObject {
    static let shared = MainNav()
    /// 右 Panel は既定で閉じる（§Workspace）。
    @Published var activityOpen = false
    /// Home の Session Card から開いた会議（§8 Home → Session Detail の導線）。
    @Published var openSession: String?
    @Published var section: MainSection = .home
    /// 会議詳細のプレビュー（Library から開いた状態を撮るため）。
    @Published var meetingDetail = false

    /// 会議詳細で見せている会議の名前。
    var meetingTitle = "A社 新規提案"

    /// いま開いている面の見出し。表示はここから引く（画面側で別名を持たない）。
    /// ゲートもこれと実際の見出しを突き合わせる。
    ///
    /// 会議詳細は "Meeting" ではなく**その会議の名前**にする。一覧が "Meetings" なので、
    /// 1 文字違いの見出しでは「一覧に居るのか 1 件を開いているのか」が見分けられなかった。
    var title: String {
        if let id = openSession, let s = MeetingSessionStore.shared.session(id: id) { return s.title }
        if meetingDetail { return meetingTitle }
        return section.title
    }
}

/// 4 タブの native シェル。Windows 版は同じ構成を NavigationView + Mica で作る（設計共通・実装別）。
struct MainWindowView: View {
    @StateObject private var nav = MainNav.shared
    @ObservedObject private var uiScale = UIScale.shared
    @StateObject private var data = MainData()

    var body: some View {
        NavigationSplitView {
            List(MainSection.allCases, selection: $nav.section) { s in
                // 既定の 13pt のままで、他を大きくしたぶん相対的に小さく見えていた。
                Label(s.title, systemImage: s.icon)
                    .font(.system(size: TypeScale.bodySize))
                    .padding(.vertical, 3)
                    .tag(s)
            }
            .navigationSplitViewColumnWidth(min: S.metric(Metrics.sidebarWidth) - 20, ideal: S.metric(Metrics.sidebarWidth), max: S.metric(Metrics.sidebarWidth) + 40)
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 8) {
                    Circle().fill(Color.astraAccent.opacity(0.2)).frame(width: 26, height: 26)
                        .overlay(Text("U").font(.system(size: 12, weight: .semibold)))
                    Text("ui-check").font(.system(size: TypeScale.secondarySize))
                    Spacer()
                }.padding(10)
            }
        } detail: {
            detailContent
                // 見出しは開いている面に合わせる。
                //
                // 以前も同じ意図でここに書いてあったが、効いていなかった。各 Pane が
                // それぞれ `.navigationTitle` を持っていて（Home / Work / Library / Apps /
                // Tasks / Meetings / Plugins / Meeting の 8 か所）、どれが勝つかが
                // SwiftUI の解決順に委ねられていたため。会議詳細を開いても "Home" のままだった。
                // 見出しを決めるのはここ 1 か所だけにする。
                .navigationTitle(nav.title)
                // 右の Agent Activity は **既定で閉じる**。Content を主役にする（Linear の作法）。
                .inspector(isPresented: $nav.activityOpen) {
                    AgentActivityPane()
                        .inspectorColumnWidth(min: S.metric(Metrics.inspectorWidth) - 40, ideal: S.metric(Metrics.inspectorWidth), max: S.metric(Metrics.inspectorWidth) + 60)
                }
                .toolbar {
                    ToolbarItem {
                        Button { nav.activityOpen.toggle() } label: {
                            Image(systemName: "sidebar.trailing")
                        }
                        .help("Agent Activity")
                        .accessibilityIdentifier("toggleActivity")
                    }
                }
        }
        .frame(minWidth: 940, minHeight: 620)
        .onAppear { data.load() }
    }

    @ViewBuilder private var detailContent: some View {
        Group {
            if let id = nav.openSession, let session = MeetingSessionStore.shared.session(id: id) {
                SessionDetailView(session: session)
            } else if nav.meetingDetail {
                MeetingArtifactView(
                    title: "A社 新規提案", duration: "42:18", participants: 3,
                    summary: [MeetingCitation(number: 1, text: "先方は10月導入を希望。最大の懸念は初期費用。", transcriptTime: "14:18", speaker: "田中")],
                    decisions: [MeetingCitation(number: 2, text: "導入時期を10月で検討", transcriptTime: "14:22", speaker: "鈴木")],
                    actionItems: [MeetingCitation(number: 3, text: "伊藤 修正版見積を送付 明日", transcriptTime: "14:31", speaker: "伊藤")],
                    selected: MeetingCitation(number: 1, text: "初期費用が少し気になっています。", transcriptTime: "14:18", speaker: "田中")
                )
            } else {
                switch nav.section {
                case .home: HomePane(recent: data.library)
                case .tasks: TasksPane()
                case .meetings: MeetingsPane()
                case .library: LibraryPane(titles: data.library)
                case .agents: AgentsPane(apps: data.apps)
                case .plugins: PluginsPane()
                }
            }
        }
    }
}

/// 右の Agent Activity。既定は閉じていて、要るときだけ開く。
private struct AgentActivityPane: View {
    @ObservedObject private var store = AstraStateStore.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Agent Activity")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.muted(dark))
            if store.state.activeTask != nil {
                TaskTimelineView()
            } else {
                Text("いま動いている仕事はありません。")
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted(dark))
            }
            // 直近の出来事（§28 EventBus）。何が起きたかを追えるようにする。
            if !AstraEventBus.shared.recent.isEmpty {
                Divider().overlay(Palette.border(dark))
                ForEach(Array(AstraEventBus.shared.recent.suffix(6).enumerated()), id: \.offset) { _, e in
                    Text(e.name)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Palette.muted(dark))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("agentActivity")
    }
}

struct HomePane: View {
    let recent: [String]
    /// 直近の予定は**実カレンダー**から取る（MEET-001）。許可が無ければ空のまま（架空の予定を作らない）。
    @State private var upcoming: [HomeAttention] = []

    var body: some View {
        // §8 Home: greeting + intent・Attention（実カレンダー）・Active work（実 Library）。
        HomeView(
            attention: upcoming,
            active: recent.prefix(3).map { HomeWork(title: $0, meta: "資料 · Library") }
        )
        .onAppear(perform: loadUpcoming)
    }

    /// 撮影用の差し込み。**実カレンダーに予定があればそちらが勝つ**。
    /// この Mac に予定が無い時間帯でも Upcoming の見た目を確かめられるようにするためのもの。
    nonisolated(unsafe) static var previewUpcoming: [HomeAttention] = []

    private func loadUpcoming() {
        let fmt = DateFormatter(); fmt.dateFormat = "HH:mm"
        // 終日の予定（誕生日・祝日など）は会議ではない。ここに「録音を開始」を出すと
        // 押しても意味が無い導線になるので、時刻のある予定だけを Attention にする。
        let timed = CalendarAccess.upcoming(hours: 24).filter { e in
            let duration = e.endEpoch - e.startEpoch
            return duration > 0 && duration < 20 * 3600
        }
        guard !timed.isEmpty else {
            // 実データが無いときだけ、差し込みがあれば使う（無ければ空のまま）。
            upcoming = HomePane.previewUpcoming
            return
        }
        upcoming = timed.prefix(3).map { e in
            HomeAttention(
                kind: fmt.string(from: Date(timeIntervalSince1970: e.startEpoch)) + " " + e.calendar,
                title: e.title,
                action: "録音を開始",
                // §6 予定 → Session。project は前に同じ題で録っていれば引き継ぐ。
                link: CalendarLink(
                    // EKEvent の識別子はここまで持ってきていないので、
                    // 予定を一意にできる範囲（題＋開始時刻）で作る。推測で埋めない。
                    eventId: "\(e.title)@\(Int(e.startEpoch))",
                    title: e.title,
                    participantCount: 0,
                    meetingURL: nil,
                    projectId: MeetingSessionStore.rememberedProject(forTitle: e.title))
            )
        }
    }
}

/// §9 Work: 仕事単位で管理（Active/Waiting/Done/Failed/All）。Agent は詳細/管理者向けにのみ開示。
private struct AgentsPane: View {
    let apps: [String]
    @State private var filter = "Active"
    private let filters = ["Active", "Waiting", "Done", "Failed", "All"]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    ForEach(filters, id: \.self) { f in
                        Text(f)
                            .font(.system(size: TypeScale.secondarySize, weight: filter == f ? .semibold : .regular))
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Capsule().fill(filter == f ? Color.astraAccent.opacity(0.15) : Color.clear))
                            .foregroundStyle(filter == f ? Color.astraAccent : Color.secondary)
                            .onTapGesture { filter = f }
                    }
                    Spacer()
                }
                // 実タスクが無い間は spec 構造 + 正直な空状態（架空タスクを作らない）。
                Text("実行中の仕事はありません。Task Dock から「◯◯して」と頼むとここに出ます。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                Spacer()
            }.padding(24)
        }
    }
}

private struct LibraryPane: View {
    let titles: [String]
    @State private var typeFilter = "All"
    private let types = ["All", "Meeting", "Report", "Document", "Image", "Video", "Other"] // §10.1
    var body: some View {
        let items = titles.isEmpty ? ["（まだありません）"] : titles
        return ScrollView {
            HStack(spacing: 6) { // §10.1 Type chips
                ForEach(types, id: \.self) { t in
                    Text(t)
                        .font(.system(size: TypeScale.secondarySize, weight: typeFilter == t ? .semibold : .regular))
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Capsule().fill(typeFilter == t ? Color.astraAccent.opacity(0.15) : Color.clear))
                        .foregroundStyle(typeFilter == t ? Color.astraAccent : Color.secondary)
                        .onTapGesture { typeFilter = t }
                }
                Spacer()
            }.padding(.horizontal, 20).padding(.top, 16)
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
        }
    }
}

/// §10 Apps: 「できる仕事を増やす場所」。接続状態は **色だけでなく文字でも**示す（§17）。
private struct AppsPane: View {
    let apps: [String]
    @ObservedObject private var connectors = ConnectorState.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    /// APP-002 の状態。トグル 1 個では「未接続 / 権限が要る / 繋げない」が区別できないので分ける。
    private enum ConnState {
        case connected, disconnected, permissionRequired
        var label: String {
            switch self {
            case .connected: return "接続済み"
            case .disconnected: return "未接続"
            case .permissionRequired: return "設定が必要"
            }
        }
        /// 止まっている理由を必ず添える。「設定が必要」だけでは何をすればいいか分からない。
        var reason: String? {
            switch self {
            case .permissionRequired: return "接続に使う client ID がまだ設定されていません"
            case .connected, .disconnected: return nil
            }
        }
        var icon: String {
            switch self {
            case .connected: return "checkmark.circle.fill"
            case .disconnected: return "circle"
            case .permissionRequired: return "exclamationmark.triangle.fill"
            }
        }
    }

    private func stateOf(_ app: String) -> ConnState {
        if connectors.connected.contains(app) { return .connected }
        // provider があるのに繋げない＝client_id 未設定。繋げるつもりにさせない。
        if ConnectorState.provider(for: app) != nil && !connectors.canConnect(app) { return .permissionRequired }
        return .disconnected
    }

    private func tint(_ s: ConnState) -> Color {
        switch s {
        case .connected: return Palette.success(dark)
        case .permissionRequired: return Palette.warning(dark)
        case .disconnected: return .secondary
        }
    }

    var body: some View {
        let apps = self.apps.isEmpty ? ["Gmail", "Google Calendar", "Finder"] : self.apps
        return ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text("できる仕事を増やす").font(.system(size: 16, weight: .semibold))
                Text("Pack や Connector を追加すると、Astra ができる仕事が増えます。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 16)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                ForEach(apps, id: \.self) { a in
                    let st = stateOf(a)
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 7).fill(Color.astraAccent.opacity(0.85))
                            .frame(width: 27, height: 27)
                            .overlay(Text(String(a.prefix(1))).font(.system(size: 12, weight: .bold)).foregroundStyle(.white))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a).font(.system(size: 12, weight: .semibold))
                            HStack(spacing: 4) {
                                Image(systemName: st.icon).font(.system(size: 9))
                                Text(st.label).font(.system(size: 10))
                            }
                            .foregroundStyle(tint(st))
                            if let reason = st.reason {
                                Text(reason).font(.system(size: 10)).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                        // 繋げるものだけ操作を出す。繋げないものに操作を出して失敗させない。
                        if st == .connected {
                            Button("切断") {
                                // §16 R2: 外部サービスとの接続を切る＝外部への副作用。
                                guard Confirm.ask(ActionConfirmation(
                                    title: "\(a) との接続を切ります",
                                    details: ["Astra はこのアプリを読めなくなります",
                                              "使うにはもう一度つなぎ直してください"],
                                    risk: .r2,
                                    confirmLabel: "切断する")) else { return }
                                connectors.connected.remove(a)
                            }
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .frame(height: 28).padding(.horizontal, 8)
                                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                        } else if connectors.canConnect(a) {
                            Button("接続") { _ = connectors.connect(a) }
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.astraAccent(dark))
                                .frame(height: 28).padding(.horizontal, 8)
                                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                        }
                    }
                    .padding(12)
                    // 枠線を黒で直書きしていたため dark でカードの縁が消えていた（実機で判明）。
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.cardSurface(dark).opacity(dark ? 0.5 : 0)))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.hairline(dark)))
                    .accessibilityIdentifier("connector-\(a)")
                }
            }.padding(20)
        }
    }
}
