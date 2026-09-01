import SwiftUI

/// 録音中に立ち上がる面。**Dock ではなく、録音のあいだだけ現れる別のサーフェス**。
///
/// DeepNote 型のノート・キャンバスにしてある。主役は文字起こしの生ログではなく、
/// 会議が進むにつれて**書かれていくノート**:
///
/// ```text
/// ┌─ notch + Task Dock ────────────────────────────────┐
/// │ ● 録音中 04:21                    [ノート|文字起こし] │
/// ├──────────────────────────────┬─────────────────────┤
/// │ 決まったこと                  │ Live transcript     │
/// │  · 導入時期は 10 月で行きます   │ 田中 それでは…      │
/// │ やること                      │ あなた 了解しました  │
/// │  · 見積は明日までに            │ 鈴木 OAuth だけ…    │
/// │ 宿題 / 懸念                   │                     │
/// │ （ノートとして読める）         │ （脇に控える）       │
/// ├──────────────────────────────┴─────────────────────┤
/// │ Ask Astra…                                          │
/// └─────────────────────────────────────────────────────┘
/// ```
///
/// 会議のあとで欲しいのは発言の全文ではなくノートなので、そちらを主列に置く。
/// 生ログは消さずに右へ控えさせ、`[ノート|文字起こし]` で入れ替えられる。
struct RecordingWorkspaceView: View {
    @StateObject private var state = RecordingWorkspaceState.shared

    var body: some View {
        ZStack(alignment: .top) {
            RecordingSurface()
            workspaceContent
            TaskDockView(state: state).offset(y: 3)
        }
        .frame(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight)
        .animation(.easeOut(duration: Motion.drawerMs), value: state.ragOpen)
        .onChange(of: state.selectedTool) { _, tool in
            if tool == .translation, state.translatedText.isEmpty { state.translate() }
        }
        .accessibilityIdentifier("recordingWorkspace")
    }

    private var workspaceContent: some View {
        VStack(spacing: 0) {
            // 上辺は notch と Task Dock の領域。本文はその下から始める。
            Spacer(minLength: 0).frame(height: Metrics.wsContentTop)

            RecordingStatusBar(state: state)
                .padding(.horizontal, Metrics.wsGutter)
                .frame(height: Metrics.wsStatusBar)

            HStack(alignment: .top, spacing: Metrics.wsColumnGap) {
                // 主列: 書かれていくノート。会議のあとに読み返すのはこちら。
                MeetingNotesCanvas(state: state)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // 右: 生ログと AI 操作。脇に控えさせる（消しはしない）。
                RecordingSideRail(state: state)
                    .frame(width: Metrics.wsRightColumn)
            }
            .padding(.horizontal, Metrics.wsGutter)
            .padding(.top, 10)
            .frame(maxHeight: .infinity)

            AskAstraBar(state: state)
                .padding(.horizontal, Metrics.wsGutter)
                .frame(height: Metrics.wsAskBar)

            // 下: RAG。閉じているときは 1 本のバー、開くとこの区画だけが伸びる。
            ragSection
        }
        .frame(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight)
    }

    /// AI の結果が出ているか（右レールの並びを決める）。
    private var hasAIOutput: Bool { state.aiRunning || !state.aiResult.isEmpty }

    @ViewBuilder private var ragSection: some View {
        if state.ragOpen {
            RAGDrawerView(state: state)
                .frame(height: Metrics.wsRagDrawer)
                .padding(.horizontal, Metrics.wsGutter)
                .padding(.bottom, Metrics.wsGutter)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        } else {
            Button { state.ragOpen = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "books.vertical")
                    Text("AI が見ている資料")
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.astraAccent)
                .frame(height: Metrics.wsBottomBar - 12)
                .padding(.horizontal, 14)
            }
            .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
            .accessibilityIdentifier("ragToggle")
            .padding(.bottom, 10)
        }
    }
}

/// 録音の状態は細いバーに落とす。巨大な波形やタイマーで面積を使わない。
private struct RecordingStatusBar: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState
    @ObservedObject private var store = AstraStateStore.shared

    private var silent: Bool { state.permissionIssue != nil }

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(silent || state.isPaused ? Color.secondary : Color.recordingRed)
                .frame(width: 9, height: 9)
            Text(silent ? "\(state.heroText)（音声なし）" : state.heroText)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.text(dark))
            Text(state.elapsedText)
                .font(.system(size: 15, design: .monospaced))
                .foregroundStyle(Palette.muted(dark))
            // 波形は「録れている」ことの小さな印にとどめる。
            Waveform(levels: silent ? Array(repeating: 0.04, count: state.audioLevels.count) : state.audioLevels)
                .frame(width: 60, height: 16)
                .opacity(silent ? 0.4 : 1)
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("recordingStatus")
    }
}

/// 右: 生ログと AI に頼める操作。ノートの脇に控える。
private struct RecordingSideRail: View {
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PermissionBanner(state: state)
            RecordingToolPalette(selection: $state.selectedTool)
            TranscriptPanel(state: state)
                .frame(maxHeight: .infinity)
            TaskTimelineView()
            AIResultPanel(state: state)
            AIActionsPalette(state: state)
        }
        .accessibilityIdentifier("recordingSideRail")
    }
}

/// DeepNote 型のノート面。会議が進むにつれてここが書かれていく。
///
/// Markdown を吐くのではなく、`MeetingCanvas`（決定 / やること / 宿題 / 懸念）の
/// 構造データから書く。まだ何も無いときは、空の見出しを並べずに 1 行だけ出す
/// —— 空の枠が並ぶと「動いていない」ではなく「壊れている」ように見える。
private struct MeetingNotesCanvas: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState
    @ObservedObject private var store = AstraStateStore.shared

    var body: some View {
        let canvas = store.state.meeting.canvas
        let session = MeetingSessionStore.shared.live
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // **開始 0 秒から空にしない。**
                //
                // 拾えたものが無いうちは白紙だった。会議が始まった直後こそ
                // 「ちゃんと聞いているのか」が不安になるところなので、いちばん悪い。
                // 会議の素性・いま聞こえていること・何を待っているかを出す。
                // ただし**偽の skeleton は置かない**。無いものは「待っています」と言う。
                header(session)
                liveLine
                Divider().overlay(Palette.border(dark))
                group("決まったこと", canvas.decisions,
                      waiting: "決まったことを待っています…")
                group("やること", canvas.actions,
                      waiting: "やることを待っています…")
                if !canvas.questions.isEmpty { group("宿題", canvas.questions, waiting: nil) }
                if !canvas.concerns.isEmpty { group("懸念", canvas.concerns, waiting: nil) }
                // メモ。**描かないと、拾ったのに画面から消える。**
                // 決定にも作業にも当てはまらない発言はここへ入るが、以前は
                // どのグループにも出しておらず、黙って落ちていた。
                if !canvas.notes.isEmpty { group("メモ", canvas.notes, waiting: nil) }
                Spacer(minLength: 0)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.never)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.hairline(dark)))
        )
        .accessibilityIdentifier("meetingNotes")
    }

    /// 開いている行。押した 1 件だけ開く。
    @State private var openedItem: UUID?
    /// 直しているときの文言。
    @State private var editText = ""
    @State private var editing: UUID?

    /// その項目の前後の文字起こし。拾った時刻を挟んで前後 1 行ずつ。
    private func context(_ line: CanvasItem) -> [TranscriptSegment] {
        guard let at = line.at, !state.transcript.isEmpty else { return [] }
        let sorted = state.transcript.sorted { $0.at < $1.at }
        guard let i = sorted.firstIndex(where: { $0.at >= at - 2 }) else { return [] }
        let lo = max(0, i - 1), hi = min(sorted.count - 1, i + 1)
        return Array(sorted[lo...hi])
    }

    /// 出所。**その発言の前後を読ませ、違っていたらその場で直せる。**
    ///
    /// 音声へ戻る導線は置かない —— 再生の実装が無いので、押して何も起きない
    /// 飾りになる。実装したら足す。
    @ViewBuilder private func provenance(_ line: CanvasItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // 行そのものが「10:42 Ken 〜」を出しているので、ここで同じ文を
            // もう一度出しても確かめたことにならない。**前後の文字起こし**を出す。
            // 前後が読めて初めて「そういう文脈で言ったのか」が分かる。
            let around = context(line)
            if around.isEmpty {
                Text(state.transcript.isEmpty
                     ? "文字起こしがまだありません。"
                     : "この時刻の文字起こしが見つかりません。")
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted(dark))
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(around) { seg in
                        // どれがその発言かが分からないと、前後を出した意味が無い。
                        // 当該行だけ濃く出す（他は文脈として薄く）。
                        let isSource = abs(seg.at - (line.at ?? -1)) < 2
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(seg.timeLabel)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.tertiary)
                                .frame(width: 34, alignment: .leading)
                            Text(seg.speaker)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Palette.muted(dark))
                                .frame(width: 44, alignment: .leading)
                            Text(seg.text)
                                .font(.system(size: 12, weight: isSource ? .semibold : .regular))
                                .foregroundStyle(isSource ? Palette.text(dark) : Palette.muted(dark))
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                    }
                }
                .onAppear { UIProbe.register("canvasContext", {}) }
                .onDisappear { UIProbe.unregister("canvasContext") }
            }

            if editing == line.id {
                TextField("直す", text: $editText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Palette.surface(dark)))
                    .accessibilityIdentifier("canvasEditField")
                HStack(spacing: 8) {
                    Button("直す") {
                        MeetingIntelligence.shared.edit(line, to: editText)
                        editing = nil; openedItem = nil
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Palette.accent(dark))
                    .frame(height: 26).padding(.horizontal, 10)
                    .buttonStyle(AstraControlStyle(radius: 6, base: 0.05))
                    Button("やめる") { editing = nil }
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(height: 26).padding(.horizontal, 8)
                        .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 8) {
                    ProbeButton(id: "canvasEdit",
                                action: { editing = line.id; editText = line.text }) { Text("直す") }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Palette.accent(dark))
                        .frame(height: 26).padding(.horizontal, 10)
                        .buttonStyle(AstraControlStyle(radius: 6, base: 0.05))
                                            ProbeButton(id: "canvasRemove",
                                action: { MeetingIntelligence.shared.remove(line); openedItem = nil }) {
                        Text("これは違う")
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(height: 26).padding(.horizontal, 8)
                    .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                                        Spacer(minLength: 0)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(Color.subtleFill(dark, 0.04)))
    }

    /// 会議の素性。題・出所・人数は、拾う前から分かっている。
    @ViewBuilder private func header(_ session: MeetingSession?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session?.title ?? store.state.meeting.detectedApp ?? "会議")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Palette.text(dark))
            HStack(spacing: 12) {
                if let src = session?.source ?? store.state.meeting.detectedApp {
                    Label(src, systemImage: "video")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(dark))
                }
                if let n = session?.participantCount, n > 0 {
                    Label("\(n) 人", systemImage: "person.2")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(dark))
                }
                if let link = session?.calendarEventId, !link.isEmpty {
                    Label("予定から", systemImage: "calendar")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(dark))
                }
            }
        }
    }

    /// いま聞こえていること。ここが動いていれば「聞いている」と分かる。
    @ViewBuilder private var liveLine: some View {
        if let last = state.transcript.last {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(last.speaker)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.accent(dark))
                Text(last.text)
                    .font(.system(size: 15))
                    .foregroundStyle(last.interim ? Palette.muted(dark) : Palette.text(dark))
                    .lineLimit(2)
            }
        } else {
            Label("聞いています…", systemImage: "waveform")
                .font(.system(size: 13))
                .foregroundStyle(Palette.muted(dark))
        }
    }

    @ViewBuilder private func group(_ title: String, _ lines: [CanvasItem],
                                    waiting: String?) -> some View {
        if lines.isEmpty, let waiting {
            // 何も無いことを隠さない。**偽の skeleton は置かない。**
            VStack(alignment: .leading, spacing: 7) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                    .tracking(0.4)
                Text(waiting)
                    .font(.system(size: 14))
                    .foregroundStyle(Palette.muted(dark).opacity(0.7))
            }
        } else if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                    .tracking(0.4)
                // 拾った行は、いつ誰が言ったのかを添えて出す。
                // 押すと**原文と直す手段**が開く。確かめられて、違っていたら
                // 直せて、初めて「検証できる」と言える。
                ForEach(lines) { line in
                    VStack(alignment: .leading, spacing: 6) {
                    ProbeButton(id: "canvasItem-\(line.id.uuidString.prefix(8))",
                                action: { openedItem = (openedItem == line.id) ? nil : line.id }) {
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        if let t = line.timeLabel {
                            Text(t)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(Palette.muted(dark))
                                .frame(width: 38, alignment: .leading)
                        } else {
                            Text("·").foregroundStyle(Palette.muted(dark))
                        }
                        if let who = line.speaker {
                            Text(who)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Palette.accent(dark))
                        }
                        Text(line.text)
                            .font(.system(size: 16))
                            .foregroundStyle(Palette.text(dark))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Image(systemName: openedItem == line.id ? "chevron.up" : "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(Palette.muted(dark))
                    }
                    .contentShape(Rectangle())
                    }
                    .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))

                    if openedItem == line.id { provenance(line) }
                    }
                }
            }
            .accessibilityIdentifier("notes-\(title)")
        }
    }
}

/// 会議について聞く。SuperIntern の Ask に当たる位置。
private struct AskAstraBar: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState
    @State private var question = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 12))
                .foregroundStyle(Palette.accent(dark))
            TextField("この会議について聞く", text: $question)
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .foregroundStyle(Palette.text(dark))
                .focused($focused)
                .onSubmit(ask)
                .accessibilityIdentifier("askAstraField")
            Button { VoiceHUDState.shared.beginListening() } label: {
                Image(systemName: "mic")
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(width: 28, height: 28)   // §16 hit area
            }
            .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
            .accessibilityIdentifier("askAstraMic")
        }
        .padding(.horizontal, 14)
        .frame(maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(focused ? Palette.accent(dark) : Color.hairline(dark),
                            lineWidth: focused ? Metrics.focusRing : 1))
        )
        .padding(.bottom, 10)
        .accessibilityIdentifier("askAstra")
    }

    private func ask() {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        question = ""
        state.runAIAction(text)
    }
}

/// 面 + 本物の vibrancy + 凹み。light は白基調、dark は canvas トークンへ追従する
/// （白のままだと本文が白 on 白になって読めなくなる。実機の dark 撮影で確認した）。
struct RecordingSurface: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    var body: some View {
        RecordingWorkspaceShape()
            .fill(Color.workspaceSurface(dark))
            .background(RecordingWorkspaceShape().fill(.ultraThinMaterial))
            .overlay(RecordingWorkspaceShape().stroke(Color.hairline(dark), lineWidth: 0.7))
            .shadow(color: .black.opacity(dark ? 0.45 : 0.17), radius: 30, y: 13)
    }
}
