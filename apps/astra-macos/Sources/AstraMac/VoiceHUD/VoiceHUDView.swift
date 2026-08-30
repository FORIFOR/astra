import AppKit
import SwiftUI

/// Task Dock。画面上辺中央に常駐する **Astra という一つの存在**。
///
/// 窓は増やさない。状態に応じてこの一枚が大きさと役割を変える:
///
/// ```text
/// idle          156×34   ◦
/// appContext    196×34   ◈ Notion
/// 展開          320×190  Notion / Q3 Product Roadmap / Suggested…
/// listening     420×84   ◉ ▁▂▄▆▃  このページからタスクを作って…
///                        Screen ✓  Notion ✓  Selection ✓
/// thinking      300×44
/// agent         480×可変 ✓ Calendar / ● Notion / ○ Web …
/// confirmation  420×210  Dock 自身が聞く（NSAlert も別窓も使わない）
/// meeting       460×56   必要な面だけ開く（常時 5 枚並べない）
/// ```
///
/// 高さが変わるときは **上辺の Y を固定**して下へ伸ばす（`WindowCoordinator`）。
struct VoiceTaskDockView: View {
    /// §10 Interface Size を変えたら描き直す（購読していないと変わらない）。
    @ObservedObject private var uiScale = UIScale.shared
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var state = VoiceHUDState.shared
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var dark: Bool { scheme == .dark }

    /// 面が縮み終わってから中身を出す。同時に動かすと中身がはみ出して見える。
    @State private var contentVisible = true

    var body: some View {
        ZStack(alignment: .top) {
            DockSurface()
            content
                .opacity(contentVisible ? 1 : 0)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: contentVisible)
        }
        // 地が暗いので、中身も暗色側の配色で描く。
        // 各 View は `@Environment(\.colorScheme)` を見ているので、ここで一括して切り替わる。
        .environment(\.colorScheme, .dark)
        .frame(width: size.width, height: size.height)
        .onChange(of: store.dock) { _, _ in
            guard !reduceMotion else { return }
            // 面のリサイズが終わる少し後に中身を戻す（§Animation 40–70ms）。
            contentVisible = false
            DispatchQueue.main.asyncAfter(deadline: .now() + Motion.dockResizeMs + Motion.dockContentDelayMs) {
                contentVisible = true
            }
        }
        .accessibilityIdentifier("voiceHUD")
        .accessibilityLabel("Astra")
    }

    private var size: CGSize { store.dock.size(agentRows: store.state.activeTask?.steps.count ?? 0) }

    @ViewBuilder private var content: some View {
        switch store.dock {
        case .idle: IdleDock()
        case .appContext(let summary): AppContextDock(summary: summary, expanded: false)
        case .appContextExpanded(let summary): AppContextDock(summary: summary, expanded: true)
        case .listening(let partial): ListeningDock(partial: partial)
        case .thinking: ThinkingDock()
        case .agent: AgentDock()
        case .confirmation(let confirmation): ConfirmationDock(confirmation: confirmation)
        case .meeting(let panel): MeetingDock(open: panel)
        case .result(let result): ResultDock(result: result)
        case .contextDetail: ContextDetailDock()
        case .quickActions: QuickActionsDock()
        case .enteringRecording: SimpleDock(icon: "record.circle", text: "録音を始めます…", tint: .recordingRed)
        }
    }
}

/// 旧名。既存の呼び出しを壊さないための別名。
typealias VoiceHUDView = VoiceTaskDockView

// MARK: - 1. Idle / Presence

/// いちばん静かな姿。名前も説明も出さない。押すと開く。
private struct IdleDock: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        HStack(spacing: 7) {
            AstraOrb()
            Text("Astra")
                .font(.system(size: S.type(Metrics.dockPrimarySize), weight: .medium))
                .foregroundStyle(Palette.muted(scheme == .dark))
            Spacer(minLength: 0)
            KeyBadge("⌥")
            KeyBadge("space")
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { VoiceHUDState.shared.toggleQuickActions() }
        // Quick Actions を挟まずに 1 手で開く道も用意する（2 クリックが要るのは面倒）。
        .simultaneousGesture(TapGesture().modifiers(.command).onEnded {
            MainWindowController.shared.showSection(.home)
            AstraStateStore.shared.workspaceOpened()
        })
        .help("クリックで操作、⌘クリックで Astra を開く")
        .accessibilityIdentifier("dockIdle")
    }
}

// MARK: - 2. App Context

/// アプリを認識したとき。閉じているときは **1 行だけ**（巨大 popup を出さない）。
private struct AppContextDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let summary: AppContextSummary
    let expanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                Image(systemName: "diamond.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(Palette.accent(dark))
                Text(summary.app)
                    .font(.system(size: S.type(Metrics.dockPrimarySize), weight: .medium))
                    .foregroundStyle(Palette.text(dark))
                Spacer(minLength: 0)
                if !summary.suggestions.isEmpty {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                }
            }
            .padding(.horizontal, S.metric(Metrics.dockPadH))
            .frame(height: Metrics.dockContextHeight)
            .contentShape(Rectangle())
            .onTapGesture { VoiceHUDState.shared.toggleContextExpanded() }
            .accessibilityIdentifier("dockAppContext")

            if expanded {
                Divider().overlay(Palette.border(dark))
                VStack(alignment: .leading, spacing: 8) {
                    if let document = summary.document {
                        Text(document)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Palette.text(dark))
                            .lineLimit(1)
                    }
                    DockLabel(text: "Suggested")
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(summary.suggestions, id: \.self) { s in
                            Button { VoiceHUDState.shared.runSuggestion(s) } label: {
                                HStack(spacing: 0) {
                                    Text(s)
                                        .font(.system(size: S.type(Metrics.dockRowSize)))
                                        .foregroundStyle(Palette.text(dark))
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 8)
                                .frame(height: Metrics.dockAgentRowHeight)
                            }
                            .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                            .accessibilityIdentifier("suggest-\(s)")
                        }
                    }
                }
                .padding(.horizontal, S.metric(Metrics.dockPadH) - 4)
                .padding(.top, 9)
                Spacer(minLength: 0)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

// MARK: - 3. Listening

/// 声を聞いている。主役は波形ではなく**話した内容**。
/// 波形は左端の小さな印にとどめ、下に「何を見ているか」を必ず出す。
private struct ListeningDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared
    let partial: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                AstraOrb(active: true)
                MiniWaveform()
                    .frame(width: 44, height: 16)
                Text(partial.isEmpty ? "聞いています…" : partial)
                    .font(.system(size: S.type(Metrics.dockSpeechSize)))
                    .foregroundStyle(partial.isEmpty ? Palette.muted(dark) : Palette.text(dark))
                    .lineLimit(1)
                    .truncationMode(.head)
                Spacer(minLength: 0)
            }
            ContextStrip()
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        // 2 行を面の中で上下に振り分ける（下に余白を溜めない）。
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityIdentifier("dockListening")
    }
}

/// 「AI がいま何を見ているか」。Listening 中は必ず出す（§Listening）。
struct ContextStrip: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared

    var body: some View {
        HStack(spacing: 12) {
            ForEach(store.state.context.items) { item in
                HStack(spacing: 4) {
                    // 色を増やさない。印は形（✓）で伝え、色は orb だけに持たせる。
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                    Text(item.application)
                        .font(.system(size: S.type(Metrics.dockMetaSize)))
                        .foregroundStyle(Palette.text(dark))
                }
            }
            if store.state.context.items.isEmpty {
                Text("見えている文脈はありません")
                    .font(.system(size: S.type(Metrics.dockMetaSize)))
                    .foregroundStyle(Palette.muted(dark))
            }
            if !store.state.context.items.isEmpty {
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        // Dropover の作法。棚を押すと、棚そのものが詳細へ広がる。
        .onTapGesture { VoiceHUDState.shared.mode = .contextDetail }
        .accessibilityIdentifier("contextStrip")
    }
}

// MARK: - 4. Thinking

private struct ThinkingDock: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        SimpleDock(icon: "sparkles", text: "考えています…", tint: Palette.accent(scheme == .dark))
    }
}

private struct SimpleDock: View {
    @Environment(\.colorScheme) private var scheme
    let icon: String
    let text: String
    var tint: Color = .secondary

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 14)).foregroundStyle(tint)
            Text(text)
                .font(.system(size: S.type(Metrics.dockPrimarySize)))
                .foregroundStyle(Palette.text(scheme == .dark))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        .frame(maxHeight: .infinity)
        .accessibilityIdentifier("dockSimple")
    }
}

// MARK: - 5. Agent

/// 仕事の進行そのもの。chat bubble では出さない。
///
/// 「小さな floating utility」ではなく、デスクトップに現れる **AI task surface** に見せる。
/// そのために横幅を取り、各段に「いま何を見ているか」を 1 行添える。
private struct AgentDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared
    @State private var tick = Date()
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            taskTitle
            progressBar
            steps
            contextChips
            Spacer(minLength: 0)
            footer
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onReceive(timer) { tick = $0 }
        .accessibilityIdentifier("dockAgent")
    }

    private var header: some View {
        HStack(spacing: 10) {
            AstraOrb(active: true)
            Text("Astra")
                .font(.system(size: S.type(Metrics.dockMetaSize), weight: .medium))
                .foregroundStyle(Palette.muted(dark))
            Spacer(minLength: 0)
            if let task = store.state.activeTask {
                // 何をしているか（状態語）と、どこまで進んだか。
                Text(task.status == .running ? "Working" : task.status.rawValue.capitalized)
                    .font(.system(size: S.type(Metrics.dockMetaSize), weight: .medium))
                    .foregroundStyle(Palette.muted(dark))
                // 待っている間、どれだけ待つのかが分かるように経過も出す。
                Text(elapsedLabel(task))
                    .font(.system(size: S.type(Metrics.dockMetaSize), design: .monospaced))
                    .foregroundStyle(Palette.muted(dark))
                Text("\(Int(task.progress * 100))%")
                    .font(.system(size: S.type(Metrics.dockMetaSize), design: .monospaced))
                    .foregroundStyle(Palette.muted(dark))
            }
        }
    }

    /// 進み具合は数字だけだと目に入らない。細い帯で出す。
    @ViewBuilder private var progressBar: some View {
        if let task = store.state.activeTask {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.subtleFill(dark, 0.10))
                    Capsule().fill(Palette.accent(dark))
                        .frame(width: max(2, geo.size.width * task.progress))
                }
            }
            .frame(height: 3)
            .animation(.easeOut(duration: Motion.drawerMs), value: task.progress)
            .accessibilityIdentifier("agentProgress")
            .accessibilityLabel("進み具合 \(Int(task.progress * 100))%")
        }
    }

    private func elapsedLabel(_ task: AgentTask) -> String {
        let t = Int(max(0, tick.timeIntervalSince(task.startedAt)))
        return String(format: "%02d:%02d", t / 60, t % 60)
    }

    /// 仕事の名前は状態語と分けて、1 行の見出しにする。
    private var taskTitle: some View {
        Text(store.state.activeTask?.title ?? "実行中")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(Palette.text(dark))
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(store.state.activeTask?.steps ?? []) { step in
                HStack(spacing: 10) {
                    Image(systemName: icon(step.state))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(tint(step.state))
                        .frame(width: 13)
                    Text(step.title)
                        .font(.system(size: S.type(Metrics.dockRowSize),
                                      weight: step.state == .running ? .semibold : .regular))
                        .foregroundStyle(step.state == .pending ? Palette.muted(dark) : Palette.text(dark))
                        .frame(width: 118, alignment: .leading)
                    // その段で実際に何を見ているか。空欄のままにしない。
                    Text(step.detail)
                        .font(.system(size: S.type(Metrics.dockMetaSize)))
                        .foregroundStyle(Palette.muted(dark))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .frame(height: Metrics.dockAgentRowHeight)
                .accessibilityIdentifier("step-\(step.tool)")
            }
        }
    }

    @ViewBuilder private var contextChips: some View {
        let items = store.state.context.items
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                DockLabel(text: "Sources")
                HStack(spacing: 6) {
                    ForEach(items) { item in
                        Text(item.application)
                            .font(.system(size: S.type(Metrics.dockMetaSize)))
                            .foregroundStyle(Palette.text(dark))
                            .padding(.horizontal, 10)
                            .frame(height: 24)
                            .background(
                                Capsule().fill(Color.subtleFill(dark, 0.05))
                                    .overlay(Capsule().stroke(Color.hairline(dark), lineWidth: 0.5)))
                    }
                    Spacer(minLength: 0)
                }
            }
            .accessibilityIdentifier("agentContextChips")
        }
    }

    private var footer: some View {
        HStack(spacing: 0) {
            // 走っている仕事は止められること。止め方が無いまま待たせない。
            if store.state.activeTask?.status == .running {
                Button("Stop") { AstraStateStore.shared.finishTask(.failed) }
                    .font(.system(size: S.type(Metrics.dockMetaSize), weight: .medium))
                    .foregroundStyle(Palette.danger(dark))
                    .frame(height: 28).padding(.horizontal, 10)
                    .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
                    .accessibilityIdentifier("stopAgent")
            }
            Spacer(minLength: 0)
            Button {
                MainWindowController.shared.show()
                AstraStateStore.shared.workspaceOpened()
            } label: {
                HStack(spacing: 5) {
                    Text("Continue in Workspace")
                    Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold))
                }
                .font(.system(size: S.type(Metrics.dockMetaSize), weight: .medium))
                .foregroundStyle(Palette.accent(dark))
                .frame(height: 28).padding(.horizontal, 10)
            }
            .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
            .accessibilityIdentifier("openWorkspace")
        }
    }

    private func icon(_ s: AgentRunState) -> String {
        switch s {
        case .pending: return "circle"
        case .running: return "circle.fill"
        case .success: return "checkmark"
        case .failed: return "xmark"
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

// MARK: - 6. Confirmation

/// 確認は **Dock 自身が下へ伸びて**聞く。NSAlert も別窓も使わない。
private struct ConfirmationDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let confirmation: ActionConfirmation

    private var riskTint: Color {
        confirmation.risk == .r3 ? Palette.danger(dark) : Palette.warning(dark)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: confirmation.risk == .r3 ? "exclamationmark.octagon.fill" : "arrow.up.forward")
                    .font(.system(size: 9))
                    .foregroundStyle(riskTint)
                DockLabel(text: confirmation.risk.label, tint: riskTint)
                Spacer(minLength: 0)
            }
            Text(confirmation.title)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Palette.text(dark))
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 3) {
                ForEach(confirmation.details, id: \.self) { d in
                    Text(d)
                        .font(.system(size: S.type(Metrics.dockRowSize)))
                        .foregroundStyle(Palette.muted(dark))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button("Cancel") { AstraStateStore.shared.resolveConfirmation(approved: false) }
                    .font(.system(size: S.type(Metrics.dockRowSize)))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(height: 34).padding(.horizontal, 18)
                    .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
                    .accessibilityIdentifier("confirmCancel")
                // 外へ出る操作は、押す先が一目で分かる面にする。両方とも文字だけだと、
                // 取り消しと実行が同じ重さに見えて、暗い地では色の差しか手がかりが無い。
                Button(confirmation.confirmLabel) { AstraStateStore.shared.resolveConfirmation(approved: true) }
                    .font(.system(size: S.type(Metrics.dockRowSize), weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(height: 34).padding(.horizontal, 22)
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(riskTint))
                    .buttonStyle(AstraControlStyle(radius: 7, base: 0.0, filled: false))
                    .accessibilityIdentifier("confirmProceed")
            }
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH) + 2)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier("dockConfirmation")
    }
}

// MARK: - 7. Meeting

/// 録音中の Dock。**これが録音 UI の本体**（別窓を 3 枚出さない）。
///
/// SuperIntern の control bar の考え方を Dock に吸収した。録音を始めた時点では
/// controller だけが出て、Notes / Captions / Ask は押されたときにこの面の中身として開く。
/// 両方同時に見たいときだけ、明示的に大きな面へ detach する。
private struct MeetingDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var recording = RecordingWorkspaceState.shared
    @ObservedObject private var secret = SecretMode.shared
    let open: DockPresentation.MeetingPanel?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            controller
            if let open {
                Divider().overlay(Palette.border(dark))
                MeetingPanelBody(panel: open)
                    .padding(.horizontal, S.metric(Metrics.dockPadH))
                    .padding(.top, 12)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityIdentifier("dockMeeting")
    }

    private var controller: some View {
        HStack(spacing: 12) {
            Circle().fill(recording.isPaused ? Color.secondary : Color.recordingRed)
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 1) {
                Text(store.state.meeting.detectedApp ?? "Recording")
                    .font(.system(size: S.type(Metrics.dockPrimarySize), weight: .semibold))
                    .foregroundStyle(Palette.text(dark))
                    .lineLimit(1)
                Text(recording.elapsedText)
                    .font(.system(size: S.type(Metrics.dockMetaSize), design: .monospaced))
                    .foregroundStyle(Palette.muted(dark))
            }
            Waveform(levels: recording.audioLevels)
                .frame(width: 56, height: 16)
            Spacer(minLength: 0)
            ForEach(DockPresentation.MeetingPanel.allCases, id: \.self) { panel in
                Button { VoiceHUDState.shared.toggleMeetingPanel(panel) } label: {
                    HStack(spacing: 5) {
                        Image(systemName: panel.icon).font(.system(size: 13))
                        Text(panel.title).font(.system(size: S.type(Metrics.dockRowSize), weight: .medium))
                    }
                    .foregroundStyle(open == panel ? Palette.accent(dark) : Palette.muted(dark))
                    .frame(height: 30).padding(.horizontal, 10)
                }
                .buttonStyle(AstraControlStyle(radius: 8, base: open == panel ? 0.07 : 0.0))
                .accessibilityIdentifier("meetingPanel-\(panel.rawValue)")
            }
            // シークレット: 画面共有・録画に Astra を映さない。会議中こそ要る。
            Button { SecretMode.shared.toggle() } label: {
                Image(systemName: secret.isOn ? "eye.slash.fill" : "eye")
                    .font(.system(size: 12))
                    .foregroundStyle(secret.isOn ? Palette.accent(dark) : Palette.muted(dark))
                    .frame(width: 32, height: 30)
            }
            .buttonStyle(AstraControlStyle(radius: 8, base: secret.isOn ? 0.07 : 0.0))
            .help(secret.isOn ? "画面共有に映りません" : "画面共有に映ります")
            .accessibilityIdentifier("secretToggle")
            StopRecordingButton { WindowCoordinator.shared.toggleRecording() }
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        .frame(height: Metrics.dockMeetingHeight)
    }
}

private struct MeetingPanelBody: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var recording = RecordingWorkspaceState.shared
    let panel: DockPresentation.MeetingPanel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                DockLabel(text: panel == .notes ? "Live Notes" : panel.title)
                Spacer(minLength: 0)
                // 両方同時に見たいときだけ、大きな面へ出す（既定では出さない）。
                Button { WindowCoordinator.shared.detachMeetingSurface() } label: {
                    HStack(spacing: 4) {
                        Text("Open beside meeting")
                        Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
                    }
                    .font(.system(size: S.type(Metrics.dockLabelSize), weight: .medium))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(height: 26).padding(.horizontal, 8)
                }
                .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
                .accessibilityIdentifier("detachMeeting")
            }
            content
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("meetingPanelBody")
    }

    @ViewBuilder private var content: some View {
        switch panel {
        case .captions:
            // 切替は Dock の中に置く。以前は大きな面へ detach しないと
            // 翻訳・字幕へ行けなかった（既定の経路から到達できない機能になっていた）。
            VStack(alignment: .leading, spacing: 10) {
                RecordingToolPalette(selection: Binding(
                    get: { recording.selectedTool },
                    set: { tool in
                        recording.selectedTool = tool
                        if tool == .translation, recording.translatedText.isEmpty { recording.translate() }
                    }))
                ScrollView {
                    VStack(alignment: .leading, spacing: 9) {
                        switch recording.selectedTool {
                        case .transcript:
                            ForEach(recording.transcript.suffix(8)) { line in
                                captionLine(speaker: line.speaker, text: line.text, interim: line.interim)
                            }
                        case .translation:
                            if recording.translating {
                                Text("翻訳しています…")
                                    .font(.system(size: S.type(Metrics.dockRowSize)))
                                    .foregroundStyle(Palette.muted(dark))
                            } else if recording.translatedText.isEmpty {
                                Text("まだ訳すものがありません。")
                                    .font(.system(size: S.type(Metrics.dockRowSize)))
                                    .foregroundStyle(Palette.muted(dark))
                            } else {
                                Text(recording.translatedText)
                                    .font(.system(size: S.type(Metrics.dockRowSize)))
                                    .foregroundStyle(Palette.text(dark))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        case .captions:
                            // 字幕は話者名を出さず、直近の発言だけを大きく読ませる。
                            ForEach(recording.transcript.suffix(3)) { line in
                                Text(line.text)
                                    .font(.system(size: 20, weight: .medium))
                                    .foregroundStyle(line.interim ? Palette.muted(dark) : Palette.text(dark))
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
                .scrollIndicators(.never)
            }
        case .notes:
            let canvas = store.state.meeting.canvas
            if canvas.isEmpty {
                Text("聞きながら、決まったこと・やること・懸念をここに書いていきます。")
                    .font(.system(size: S.type(Metrics.dockRowSize)))
                    .foregroundStyle(Palette.muted(dark))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        notesGroup("Decisions", canvas.decisions)
                        notesGroup("Concerns", canvas.concerns)
                        notesGroup("Next Actions", canvas.actions)
                        notesGroup("Questions", canvas.questions)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollIndicators(.never)
            }
        case .ask:
            AskInDockField()
        }
    }

    private func captionLine(speaker: String, text: String, interim: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(speaker)
                .font(.system(size: S.type(Metrics.dockMetaSize), weight: .semibold))
                .foregroundStyle(Palette.accent(dark))
            Text(text)
                .font(.system(size: S.type(Metrics.dockRowSize)))
                .foregroundStyle(interim ? Palette.muted(dark) : Palette.text(dark))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func notesGroup(_ title: String, _ lines: [CanvasItem]) -> some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.system(size: S.type(Metrics.dockMetaSize), weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                ForEach(lines) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if let t = line.timeLabel {
                            Text(t)
                                .font(.system(size: S.type(Metrics.dockMetaSize), design: .monospaced))
                                .foregroundStyle(Palette.muted(dark))
                        } else {
                            Text("•").foregroundStyle(Palette.muted(dark))
                        }
                        Text(line.text)
                            .font(.system(size: S.type(Metrics.dockRowSize)))
                            .foregroundStyle(Palette.text(dark))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }
}

/// 会議中に、その場で聞く。
private struct AskInDockField: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @State private var question = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").font(.system(size: 12))
                    .foregroundStyle(Palette.accent(dark))
                TextField("この会議について聞く", text: $question)
                    .textFieldStyle(.plain)
                    .font(.system(size: S.type(Metrics.dockPrimarySize)))
                    .foregroundStyle(Palette.text(dark))
                    .focused($focused)
                    .onSubmit(ask)
                    .accessibilityIdentifier("askInDock")
            }
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.subtleFill(dark, 0.04))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(focused ? Palette.accent(dark) : Color.hairline(dark),
                                lineWidth: focused ? Metrics.focusRing : 1)))
            if !RecordingWorkspaceState.shared.aiResult.isEmpty {
                Text(RecordingWorkspaceState.shared.aiResult)
                    .font(.system(size: S.type(Metrics.dockRowSize)))
                    .foregroundStyle(Palette.text(dark))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func ask() {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        question = ""
        RecordingWorkspaceState.shared.runAIAction(text)
    }
}

// MARK: - 結果（CleanShot 型: 終わっても消さず、後始末を出して残す）

private struct ResultDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var sessions = MeetingSessionStore.shared
    let result: AgentResult

    /// 直近の会議の状態を 1 行で。processing の間は spinner だけにしない。
    private var sessionLine: String {
        guard let s = sessions.recent.first(where: { $0.title == result.title }) else { return "できました" }
        switch s.status {
        case .processing: return "Generating summary and actions…"
        case .ready:
            return "\(s.actionCount) actions · \(s.decisionCount) decisions · \(s.participantCount) participants"
        case .interrupted: return "途中で終わっています"
        case .failed: return "失敗しました"
        case .recording: return "録音中"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.success(dark))
                VStack(alignment: .leading, spacing: 1) {
                    Text(result.title)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Palette.text(dark))
                        .lineLimit(1)
                    // Session の状態をそのまま出す。読み取り中は「何をしているか」を言う。
                    Text(sessionLine)
                        .font(.system(size: S.type(Metrics.dockMetaSize)))
                        .foregroundStyle(Palette.muted(dark))
                }
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                ForEach(result.actions, id: \.self) { action in
                    Button(action.title) { ResultActionRunner.run(action, title: result.title) }
                        .font(.system(size: S.type(Metrics.dockRowSize), weight: .medium))
                        .foregroundStyle(Palette.text(dark))
                        .frame(height: 32).padding(.horizontal, 16)
                        .buttonStyle(AstraControlStyle(radius: 8, base: 0.07))
                        .accessibilityIdentifier("result-\(action.rawValue)")
                }
                Spacer(minLength: 0)
                Button { AstraStateStore.shared.dismissResult() } label: {
                    Image(systemName: "xmark").font(.system(size: 11))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                .accessibilityIdentifier("resultDismiss")
            }
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier("dockResult")
    }


}

// MARK: - 文脈の棚（Dropover 型: 棚そのものが詳細へ展開する）

private struct ContextDetailDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                DockLabel(text: "Context")
                Spacer(minLength: 0)
                Text("\(store.state.context.items.count) sources available to Astra")
                    .font(.system(size: S.type(Metrics.dockMetaSize)))
                    .foregroundStyle(Palette.muted(dark))
                Button { VoiceHUDState.shared.mode = .idle } label: {
                    Image(systemName: "chevron.up").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
                .accessibilityIdentifier("contextCollapse")
            }
            if store.state.context.items.isEmpty {
                Text("いま見えている文脈はありません。")
                    .font(.system(size: S.type(Metrics.dockRowSize)))
                    .foregroundStyle(Palette.muted(dark))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(store.state.context.items) { item in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(item.application)
                                .font(.system(size: S.type(Metrics.dockRowSize), weight: .semibold))
                                .foregroundStyle(Palette.text(dark))
                                .lineLimit(1)
                            Text(item.summary)
                                .font(.system(size: S.type(Metrics.dockMetaSize)))
                                .foregroundStyle(Palette.muted(dark))
                                .lineLimit(2)
                            Spacer(minLength: 0)
                            Text(item.source.label)
                                .font(.system(size: S.type(Metrics.dockLabelSize)))
                                .foregroundStyle(Palette.muted(dark))
                        }
                        .padding(12)
                        .frame(height: 104, alignment: .topLeading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.subtleFill(dark, 0.04))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(Color.hairline(dark))))
                        .accessibilityIdentifier("contextCard-\(item.application)")
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, S.metric(Metrics.dockPadH))
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier("dockContextDetail")
    }
}

// MARK: - Quick actions

private struct QuickActionsDock: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var state = VoiceHUDState.shared

    private struct Item: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let run: () -> Void
    }

    private var items: [Item] {
        [
            Item(icon: "sparkles", title: "聞く") { state.beginListening() },
            Item(icon: "record.circle", title: "録音") { WindowCoordinator.shared.toggleRecording() },
            Item(icon: "square.grid.2x2", title: "開く") { MainWindowController.shared.show() },
        ]
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items) { item in
                Button(action: item.run) {
                    HStack(spacing: 6) {
                        Image(systemName: item.icon).font(.system(size: 14))
                        Text(item.title).font(.system(size: S.type(Metrics.dockRowSize)))
                    }
                    .foregroundStyle(Palette.text(dark))
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                }
                .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
                .accessibilityIdentifier("quick-\(item.title)")
            }
        }
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .accessibilityIdentifier("dockQuickActions")
    }
}
