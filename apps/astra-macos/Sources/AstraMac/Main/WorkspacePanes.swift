import SwiftUI
import AstraCore

/// Workspace の中身。**実際にあるデータから描く**（架空の行を並べない）。
///
/// 以前は Tasks / Meetings / Agents / Plugins が同じ 2 ペインの使い回しで、
/// ナビだけ 6 本ある状態だった。ここでそれぞれの出所を分ける:
///   Tasks    → SQLite の tasks（§23/§24）
///   Meetings → ディスクの会議 journal
///   Plugins  → 同梱 manifest（§27）
struct WorkspaceHeader: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: TypeScale.pageTitleSize, weight: TypeScale.pageTitleWeight))
                .foregroundStyle(Palette.text(dark))
            Text(subtitle)
                .font(.system(size: TypeScale.secondarySize))
                .foregroundStyle(Palette.muted(dark))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 空のときに「壊れている」ではなく「まだ何もない」と読ませる。
struct WorkspaceEmpty: View {
    @Environment(\.colorScheme) private var scheme
    let title: String
    let hint: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: TypeScale.bodySize))
                .foregroundStyle(Palette.text(scheme == .dark))
            Text(hint)
                .font(.system(size: TypeScale.secondarySize))
                .foregroundStyle(Palette.muted(scheme == .dark))
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 48)
    }
}

/// 一覧の 1 行。Linear のように、行そのものが情報になるようにする。
struct WorkspaceRow<Trailing: View>: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let icon: String
    let tint: Color
    let title: String
    let detail: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: TypeScale.bodySize, weight: .medium))
                    .foregroundStyle(Palette.text(dark))
                    .lineLimit(1)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: TypeScale.secondarySize))
                        .foregroundStyle(Palette.muted(dark))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 12)
            trailing()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.hairline(dark)))
        )
    }
}

// MARK: - Tasks（§23/§24 SQLite の tasks から）

struct TasksPane: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared
    @State private var tasks: [AgentTask] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WorkspaceHeader(title: "Tasks",
                                subtitle: "Astra に頼んだ仕事。UI を閉じても走り続けます。")
                if tasks.isEmpty {
                    WorkspaceEmpty(title: "まだ頼んだ仕事はありません。",
                                   hint: "Task Dock から話しかけると、ここに履歴が残ります。")
                } else {
                    ForEach(tasks) { task in
                        WorkspaceRow(icon: icon(task.status), tint: tint(task.status),
                                     title: task.title,
                                     detail: "\(task.steps.filter { $0.state == .success }.count)/\(task.steps.count) 段 · \(Self.time.string(from: task.startedAt))") {
                            Text("\(Int(task.progress * 100))%")
                                .font(.system(size: TypeScale.secondarySize, design: .monospaced))
                                .foregroundStyle(Palette.muted(dark))
                        }
                        .accessibilityIdentifier("task-\(task.title)")
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Tasks")
        .background(Palette.canvas(dark))
        .onAppear { tasks = LocalStore.shared.loadTasks() }
        .accessibilityIdentifier("tasksPane")
    }

    private static let time: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "M/d HH:mm"; return f
    }()

    private func icon(_ s: AgentRunState) -> String {
        switch s {
        case .pending: return "circle"
        case .running: return "circle.fill"
        case .success: return "checkmark.circle"
        case .failed: return "xmark.circle"
        }
    }

    private func tint(_ s: AgentRunState) -> Color {
        switch s {
        case .pending: return Palette.muted(dark)
        case .running: return Palette.accent(dark)
        case .success: return Palette.success(dark)
        case .failed: return Palette.danger(dark)
        }
    }
}

// MARK: - Meetings（ディスクの journal から）

struct MeetingsPane: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @State private var meetings: [RecoverableMeeting] = []
    @ObservedObject private var nav = MainNav.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WorkspaceHeader(title: "Meetings",
                                subtitle: "この Mac に残っている録音。音声は端末から出ません。")
                if meetings.isEmpty {
                    WorkspaceEmpty(title: "録音した会議はまだありません。",
                                   hint: "⌥Space か Task Dock の「録音」で始められます。")
                } else {
                    ForEach(meetings, id: \.meetingId) { m in
                        Button { nav.meetingDetail = true } label: {
                            WorkspaceRow(icon: "waveform", tint: Palette.accent(dark),
                                         title: m.meetingId,
                                         detail: "\(m.startedAt) · \(Self.duration(m.recordedMs))") {
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Palette.muted(dark))
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("meeting-\(m.meetingId)")
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Meetings")
        .background(Palette.canvas(dark))
        .onAppear { meetings = RecordingRuntime.shared.recoverableMeetings() }
        .accessibilityIdentifier("meetingsPane")
    }

    /// ミリ秒を mm:ss にする。
    static func duration(_ ms: UInt64) -> String {
        let total = Int(ms / 1000)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

// MARK: - Plugins（§27 同梱 manifest から）

struct PluginsPane: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var runtime = PluginRuntimeStore.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WorkspaceHeader(title: "Plugins",
                                subtitle: "できる仕事を増やす。宣言しているだけでは動かず、許可した権限の中でだけ動きます。")
                if runtime.manifests.isEmpty {
                    WorkspaceEmpty(title: "プラグインが見つかりません。",
                                   hint: "plugins/builtin に manifest を置くとここに出ます。")
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                        ForEach(runtime.manifests, id: \.id) { m in
                            pluginCard(m)
                        }
                    }
                }
            }
            .padding(28)
        }
        .navigationTitle("Plugins")
        .background(Palette.canvas(dark))
        .onAppear { runtime.load() }
        .accessibilityIdentifier("pluginsPane")
    }

    private func pluginCard(_ m: PluginManifest) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 9) {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.astraAccent(dark).opacity(0.16))
                    .frame(width: 28, height: 28)
                    .overlay(Text(String(m.name.prefix(1)))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.accent(dark)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(m.name)
                        .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                        .foregroundStyle(Palette.text(dark))
                    Text("\(m.publisher) · \(m.version)")
                        .font(.system(size: TypeScale.secondarySize))
                        .foregroundStyle(Palette.muted(dark))
                }
                Spacer(minLength: 0)
                if m.verified {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.success(dark))
                        .help("検証済み")
                }
            }
            if m.runsLocallyOnly {
                // 資格情報が端末にしか無いものは、そのことを見せる。
                Text("この Mac の中だけで動きます")
                    .font(.system(size: TypeScale.secondarySize))
                    .foregroundStyle(Palette.muted(dark))
            }
            if !m.permissions.isEmpty {
                // 切れた文字を並べない。3 つまで出して、残りは数で言う。
                FlowChips(items: Array(m.permissions.prefix(3)),
                          overflow: max(0, m.permissions.count - 3))
            }
        }
        .padding(14)
        // 高さを揃える。行ごとに凸凹すると一覧が読みにくい。
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.hairline(dark)))
        )
        .accessibilityIdentifier("plugin-\(m.id)")
    }
}

/// 権限などの小さな札。折り返す。
struct FlowChips: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let items: [String]
    var overflow: Int = 0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.system(size: TypeScale.microSize))
                    .foregroundStyle(Palette.muted(dark))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 8)
                    .frame(height: 21)
                    .background(Capsule().fill(Color.subtleFill(dark, 0.05)))
            }
            if overflow > 0 {
                Text("+\(overflow)")
                    .font(.system(size: TypeScale.microSize))
                    .foregroundStyle(Palette.muted(dark))
            }
            Spacer(minLength: 0)
        }
    }
}

/// Plugin manifest を View から使えるようにする薄い箱（`PluginRuntime` は非 ObservableObject）。
@MainActor
final class PluginRuntimeStore: ObservableObject {
    static let shared = PluginRuntimeStore()
    @Published private(set) var manifests: [PluginManifest] = []

    func load() {
        guard manifests.isEmpty else { return }
        // 開発時はリポジトリの plugins/、配布時はバンドル内を見る。
        let candidates = [
            Bundle.main.resourcePath.map { $0 + "/plugins/builtin" },
            FileManager.default.currentDirectoryPath + "/plugins/builtin",
            "/Users/horioshuuhei/Projects/astra/plugins/builtin",
        ].compactMap { $0 }
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            let runtime = PluginRuntime.shared
            if runtime.load(from: path).loaded > 0 {
                manifests = runtime.installed
                return
            }
        }
    }
}
