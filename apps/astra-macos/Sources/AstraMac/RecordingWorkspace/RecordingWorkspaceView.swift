import SwiftUI

/// Judge を試験するための、**わざと壊した姿**。
///
/// 手描きのモックで採点者を試しても、本物を採点したときに同じ判断をする保証が
/// 無い。同じ Astra を、その軸だけ壊して撮る。
/// 既定は素の姿。`ASTRA_FIXTURE=trust-bad` などで壊す。
enum Fixture: String {
    case none
    /// 出所を完全に消す
    case noSource = "bad-no-source"
    /// 話者だけ。時刻も原文への道も無い
    case ambiguousSource = "bad-ambiguous-source"
    /// 出所は在るが、その項目から遠い場所に置く
    case wrongHierarchy = "bad-wrong-hierarchy"
    /// 根拠が無いのに「確認済み」と出す
    case fakeConfidence = "bad-fake-confidence"
    /// 拾った文と、引いた原文が食い違う
    case contradictory = "bad-contradictory"
    /// 面から引き離し、別の窓のように見せる
    case detached = "bad-detached"
    /// 主列だけ別素材にする（角丸・境界・地が揃わない）
    case mismatchedSurface = "bad-mismatched-surface"
    /// 余白が不揃い
    case unevenPadding = "bad-uneven-padding"
    /// 意味を持たない装飾を足す
    case decoration = "bad-decoration"
    /// 行の左端が揃わない
    case misaligned = "bad-misaligned"
    static var current: Fixture {
        Fixture(rawValue: ProcessInfo.processInfo.environment["ASTRA_FIXTURE"] ?? "") ?? .none
    }
}

/// 録音中に立ち上がる面。**Dock ではなく、録音のあいだだけ現れる別のサーフェス**。
///
/// DeepNote 型のノート・キャンバスにしてある。主役は文字起こしの生ログではなく、
/// 会議が進むにつれて**書かれていくノート**:
///
/// ```text
/// ┌─ notch + Task Dock ────────────────────────────────┐
/// │ 録音中 ~~~        ( ● 04:21 ⏸ CC □ … ■ )         │
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
            TaskDockView(state: state)
                .offset(x: Fixture.current == .detached ? -180 : 0,
                        y: Fixture.current == .detached ? 34 : 3)
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

                // 右: 生ログと AI の答え。脇に控えさせる（消しはしない）。
                // AI に頼む操作は下の Ask 入力の横（`AIActionsPalette`）。
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
                    // 何件見ているのかを言う。件数が無いと、資料が在るのか
                    // 無いのかも分からない。**0 件なら 0 件と言う。**
                    Text(state.ragResults.isEmpty
                         ? "AI が見ている資料 — まだありません"
                         : "AI が見ている資料 \(state.ragResults.count) 件")
                }
                .font(.system(size: TypeScale.microSize, weight: .medium))
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
///
/// **● と時計はここに置かない。** それは上の凹みの pill（`TaskDockView`）が持つ。
/// 以前は pill の時計が 0 幅に潰れて見えず、この行が ● 04:21 を重ねて出していた。
/// 同じ事実を 60pt 離れた 2 か所に出すと、どちらが本物か読む側が決めることになる。
/// この行が持つのは、言葉の状態（録音中 / 一時停止中 / 音声なし）と、
/// 録れている証拠の波形だけ。
private struct RecordingStatusBar: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState
    @ObservedObject private var store = AstraStateStore.shared

    private var silent: Bool { state.silent }

    var body: some View {
        HStack(spacing: 12) {
            Text(silent ? "\(state.heroText)\(Facts.recordingHeroSilentSuffix)" : state.heroText)
                .font(.system(size: TypeScale.bodySize, weight: .semibold))
                .foregroundStyle(Palette.text(dark))
            // 波形は「録れている」ことの小さな印にとどめる。
            Waveform(levels: silent ? Array(repeating: 0.04, count: state.audioLevels.count) : state.audioLevels)
                .frame(width: 60, height: 16)
                .opacity(silent ? 0.4 : 1)
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("recordingStatus")
    }
}

/// 右: 生ログと AI の答え。ノートの脇に控える。
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
                // 消したものを戻す道。**確認で止めるのではなく、戻せるようにする。**
                // 「これは違う」は「直す」の隣に在って押し間違えやすく、
                // 実装を知らない評価者が実際に消してしまった。
                if let removed = MeetingIntelligence.shared.lastRemoved {
                    HStack(spacing: 8) {
                        Text("「\(removed.text)」を消しました")
                            .font(.system(size: TypeScale.microSize))
                            .foregroundStyle(Palette.muted(dark))
                            .lineLimit(1)
                        ProbeButton(id: "canvasUndo",
                                    action: { MeetingIntelligence.shared.undoRemove() }) {
                            Text("元に戻す")
                                .font(.system(size: TypeScale.microSize, weight: .medium))
                                .foregroundStyle(Palette.accent(dark))
                                .padding(.horizontal, 8).padding(.vertical, 4)
                        }
                        .buttonStyle(AstraControlStyle(radius: 6, base: 0.05))
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 2)
                }
                group(Facts.notesDecisions, canvas.decisions,
                      waiting: "\(Facts.notesDecisions)を待っています…")
                group(Facts.notesActions, canvas.actions,
                      waiting: "\(Facts.notesActions)を待っています…")
                if !canvas.questions.isEmpty { group(Facts.notesQuestions, canvas.questions, waiting: nil) }
                if !canvas.concerns.isEmpty { group(Facts.notesConcerns, canvas.concerns, waiting: nil) }
                // メモ。**描かないと、拾ったのに画面から消える。**
                // 決定にも作業にも当てはまらない発言はここへ入るが、以前は
                // どのグループにも出しておらず、黙って落ちていた。
                if !canvas.notes.isEmpty { group(Facts.meetingNotes, canvas.notes, waiting: nil) }
                // wrong-hierarchy: 出所は在るが、どの項目のものか分からない場所に置く。
                if Fixture.current == .wrongHierarchy {
                    let all = canvas.decisions + canvas.actions + canvas.notes
                    if !all.isEmpty {
                        Divider().overlay(Palette.border(dark)).padding(.top, 18)
                        Text(Facts.sourceLabel)
                            .font(.system(size: TypeScale.microSize, weight: .semibold))
                            .foregroundStyle(Palette.muted(dark))
                        ForEach(all) { it in
                            Text("\(it.speaker ?? "?") · \(it.timeLabel ?? "?") · \(Facts.sourceLabel) ›")
                                .font(.system(size: TypeScale.captionSize))
                                .foregroundStyle(Palette.muted(dark))
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, Fixture.current == .unevenPadding ? 9 : 24)
            .padding(.trailing, Fixture.current == .unevenPadding ? 41 : 24)
            .padding(.top, Fixture.current == .unevenPadding ? 7 : 24)
            .padding(.bottom, Fixture.current == .unevenPadding ? 33 : 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.never)
        .background(
            // mismatched-surface: 主列だけ別素材にする（角丸・境界・地が揃わない）
            RoundedRectangle(cornerRadius: Fixture.current == .mismatchedSurface ? 2 : 12,
                             style: .continuous)
                .fill(Fixture.current == .mismatchedSurface
                      ? Color.subtleFill(dark, 0.10) : Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: Fixture.current == .mismatchedSurface ? 2 : 12,
                                          style: .continuous)
                    .stroke(Fixture.current == .mismatchedSurface
                            ? Palette.accent(dark) : Color.hairline(dark),
                            lineWidth: Fixture.current == .mismatchedSurface ? 2 : 1))
        )
        .accessibilityIdentifier("meetingNotes")
    }

    /// 開いている行。押した 1 件だけ開く。
    @State private var openedItem: UUID?
    /// 直しているときの文言。
    @State private var editText = ""
    @State private var editing: UUID?

    /// 拾った行のすぐ下に出所を 1 行。
    ///
    /// 自動評価の A/B/C で選ばれた形（Trust 3.80 → 5.00）。
    /// 根拠を最初から見せる案（B）は Trust が最も上がった（5.60）が、
    /// clarity と hierarchy を 1.0 ずつ落としたので採らなかった。
    /// 「会議から ✓」を足す案（C）は 4.80 で A に届かなかった。
    @ViewBuilder private func trustBand(_ line: CanvasItem) -> some View {
        if Fixture.current == .noSource {
            // 出所を消す。拾った文だけが残り、根拠へ辿る道が無くなる。
            EmptyView()
        } else {
        HStack(spacing: 5) {
            switch Fixture.current {
            case .ambiguousSource:
                // 話者だけ。どの発言か分からず、原文へ戻る道も無い。
                if let who = line.speaker { Text(who) }
            case .fakeConfidence:
                // 根拠が無いのに「確認済み」。**中身の無い信頼の主張。**
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 10)).foregroundStyle(Palette.success(dark))
                Text("確認済み").foregroundStyle(Palette.success(dark))
            case .wrongHierarchy:
                EmptyView()   // 下の別の場所へ出す
            default:
                if let who = line.speaker { Text(who) }
                if let t = line.timeLabel { Text("· \(t)") }
                Text("· \(Facts.sourceLabel) ›").foregroundStyle(Palette.accent(dark))
                // 訂正の道を、同じ 1 行に足す。面を増やさない。
                //
                // 検証済みの尺度（TRUST_AFFORDANCE = Evidence B、正答 97.5%）で
                // 測った結果、`to_fix` が 0/3 → 2/3。他の affordance を落とさず、
                // 地の割合も 56.6% → 56.5% でほぼ動かない。
                // 右端に置く案（鉛筆・囲みボタン）は to_fix 3/3 まで上がったが、
                // どちらも `to_source` を 3/3 → 2/3 に落としたので採らなかった。
                Text("· \(Facts.confirmationEdit)").foregroundStyle(Palette.accent(dark))
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: TypeScale.captionSize))
        .foregroundStyle(Palette.muted(dark))
        .padding(.leading, 47)
        }
    }

    /// その項目の前後の文字起こし。拾った時刻を挟んで前後 1 行ずつ。
    private func context(_ line: CanvasItem) -> [TranscriptSegment] {
        guard let at = line.at, !state.transcript.isEmpty else { return [] }
        if Fixture.current == .contradictory {
            // 拾った文と食い違う原文を引く。**出所が在るのに、内容が合わない。**
            return Array(state.transcript.sorted { $0.at < $1.at }.prefix(1))
        }
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
                    .font(.system(size: TypeScale.microSize))
                    .foregroundStyle(Palette.muted(dark))
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(around) { seg in
                        // どれがその発言かが分からないと、前後を出した意味が無い。
                        // 当該行だけ濃く出す（他は文脈として薄く）。
                        let isSource = abs(seg.at - (line.at ?? -1)) < 2
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(seg.timeLabel)
                                .font(.system(size: TypeScale.captionSize, design: .monospaced))
                                .foregroundStyle(.tertiary)
                                .frame(width: 36, alignment: .leading)
                            Text(seg.speaker)
                                .font(.system(size: TypeScale.captionSize, weight: .semibold))
                                .foregroundStyle(Palette.muted(dark))
                                .frame(width: 44, alignment: .leading)
                            Text(seg.text)
                                .font(.system(size: TypeScale.microSize, weight: isSource ? .semibold : .regular))
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
                TextField(Facts.confirmationEdit, text: $editText)
                    .textFieldStyle(.plain)
                    .font(.system(size: TypeScale.bodySize))
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Palette.surface(dark)))
                    .accessibilityIdentifier("canvasEditField")
                HStack(spacing: 8) {
                    Button(Facts.confirmationEdit) {
                        MeetingIntelligence.shared.edit(line, to: editText)
                        editing = nil; openedItem = nil
                    }
                    .font(.system(size: TypeScale.microSize, weight: .medium))
                    .foregroundStyle(Palette.accent(dark))
                    .frame(height: 26).padding(.horizontal, 10)
                    .buttonStyle(AstraControlStyle(radius: 6, base: 0.05))
                    Button(Facts.confirmationCancel) { editing = nil }
                        .font(.system(size: TypeScale.microSize))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(height: 26).padding(.horizontal, 8)
                        .buttonStyle(AstraControlStyle(radius: 6, base: 0.0))
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 8) {
                    ProbeButton(id: "canvasEdit",
                                action: { editing = line.id; editText = line.text }) { Text(Facts.confirmationEdit) }
                        .font(.system(size: TypeScale.microSize, weight: .medium))
                        .foregroundStyle(Palette.accent(dark))
                        .frame(height: 26).padding(.horizontal, 10)
                        .buttonStyle(AstraControlStyle(radius: 6, base: 0.05))
                                            ProbeButton(id: "canvasRemove",
                                action: { MeetingIntelligence.shared.remove(line); openedItem = nil }) {
                        Text("これは違う")
                    }
                    .font(.system(size: TypeScale.microSize))
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
    /// いま**実際に**届いている音源。意図ではなく実測を言う。
    ///
    /// 音が来ていないことは**本文（liveLine）が言う**ので、ここでは言わない。
    /// 見出しと本文が同じことを二重に言い、片方が赤字で、同じ画面に
    /// 「音が届いていません」「まだ音が届いていません」が並んでいた。
    /// 見出し・本文・hero は同じ真実（`RecordingWorkspaceState.liveChannels`）から組む（Atlas F2）。
    private var liveChannels: Set<SpeakerChannel> { state.liveChannels }

    private var listeningLabel: String? {
        let ch = liveChannels
        if ch.isEmpty { return nil }
        var parts: [String] = []
        if ch.contains(.localUser) { parts.append(Facts.permissionMicrophone) }
        if ch.contains(.remoteAudio) { parts.append("画面の音") }
        return parts.joined(separator: " と ") + " を聞いています"
    }

    @ViewBuilder private func header(_ session: MeetingSession?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session?.title ?? store.state.meeting.detectedApp ?? "会議")
                .font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                .foregroundStyle(Palette.text(dark))
            HStack(spacing: 12) {
                if let src = session?.source ?? store.state.meeting.detectedApp {
                    Label(src, systemImage: "video")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                if let n = session?.participantCount, n > 0 {
                    Label("\(n) 人", systemImage: "person.2")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                if let link = session?.calendarEventId, !link.isEmpty {
                    Label("予定から", systemImage: "calendar")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                // 何を聞いているのかを名前で言う。予定にもアプリにも紐付いていない
                // 録音では、ここだけが「何に対して働いているか」を示す。
                // 自動探索で選ばれた形（context 2.0 → 4.0、壊れ無し）。
                if let l = listeningLabel {
                    Label(l, systemImage: "mic")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
            }
        }
    }

    /// いま聞こえていること。ここが動いていれば「聞いている」と分かる。
    @ViewBuilder private var liveLine: some View {
        if let last = state.transcript.last {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(last.speaker)
                    .font(.system(size: TypeScale.microSize, weight: .semibold))
                    .foregroundStyle(Palette.accent(dark))
                Text(last.text)
                    .font(.system(size: TypeScale.bodySize))
                    .foregroundStyle(last.interim ? Palette.muted(dark) : Palette.text(dark))
                    .lineLimit(2)
            }
        } else if RecordingRuntime.shared.transcriptionUnavailable, state.isRecording {
            // 音は届いていて録れているが、この Mac ではオンデバイス文字起こしが始められない。
            // サーバへは出さない（`SpeechTranscriber`）。空のまま「聞いています」と言わず、理由を言う。
            Label(Facts.transcriptionOnDeviceUnavailable, systemImage: "text.badge.xmark")
                .font(.system(size: TypeScale.microSize))
                .foregroundStyle(Palette.danger(dark))
        } else if liveChannels.isEmpty, state.permissionIssue != nil {
            // 許可が無くて何も届いていない。理由は banner と transcript が既に言っている。
            // ここで三度目を言わず、「聞いています…」とも言わない。
            EmptyView()
        } else if liveChannels.isEmpty, state.isRecording {
            // **音が来ていないのに「聞いています」と言わない。**
            // 見出しが「音が届いていません」と言う横で、ここが「聞いています…」と
            // 言っていた。同じ画面の中で食い違うと、どちらも信じられなくなる。
            Label("まだ音が届いていません", systemImage: "waveform.slash")
                .font(.system(size: TypeScale.microSize))
                .foregroundStyle(Palette.danger(dark))
        } else {
            Label(Facts.listeningPlaceholder, systemImage: "waveform")
                .font(.system(size: TypeScale.microSize))
                .foregroundStyle(Palette.muted(dark))
        }
    }

    @ViewBuilder private func group(_ title: String, _ lines: [CanvasItem],
                                    waiting: String?) -> some View {
        if lines.isEmpty, let waiting {
            // 何も無いことを隠さない。**偽の skeleton は置かない。**
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    // decoration: 意味を持たない飾りを足す
                    if Fixture.current == .decoration {
                        Image(systemName: "sparkles")
                            .foregroundStyle(LinearGradient(colors: [.purple, .pink],
                                                            startPoint: .leading, endPoint: .trailing))
                        Image(systemName: "star.fill").foregroundStyle(.yellow)
                    }
                    Text(title)
                        .font(.system(size: TypeScale.microSize, weight: .semibold))
                        .foregroundStyle(Fixture.current == .decoration
                                         ? AnyShapeStyle(LinearGradient(colors: [.purple, .orange],
                                             startPoint: .leading, endPoint: .trailing))
                                         : AnyShapeStyle(Palette.muted(dark)))
                        .tracking(0.4)
                    if Fixture.current == .decoration {
                        Image(systemName: "flame.fill").foregroundStyle(.orange)
                    }
                }
                Text(waiting)
                    .font(.system(size: TypeScale.secondarySize))
                    .foregroundStyle(Palette.muted(dark).opacity(0.7))
            }
        } else if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    if Fixture.current == .decoration {
                        Image(systemName: "sparkles")
                            .foregroundStyle(LinearGradient(colors: [.purple, .pink],
                                                            startPoint: .leading, endPoint: .trailing))
                        Image(systemName: "star.fill").foregroundStyle(.yellow)
                    }
                    Text(title)
                        .font(.system(size: TypeScale.microSize, weight: .semibold))
                        .foregroundStyle(Fixture.current == .decoration
                                         ? AnyShapeStyle(LinearGradient(colors: [.purple, .orange],
                                             startPoint: .leading, endPoint: .trailing))
                                         : AnyShapeStyle(Palette.muted(dark)))
                        .tracking(0.4)
                    if Fixture.current == .decoration {
                        Image(systemName: "flame.fill").foregroundStyle(.orange)
                    }
                }
                // 拾った行は、いつ誰が言ったのかを添えて出す。
                // 押すと**原文と直す手段**が開く。確かめられて、違っていたら
                // 直せて、初めて「検証できる」と言える。
                ForEach(Array(lines.enumerated()), id: \.element.id) { idx, line in
                    VStack(alignment: .leading, spacing: 6) {
                    ProbeButton(id: "canvasItem-\(line.id.uuidString.prefix(8))",
                                action: { openedItem = (openedItem == line.id) ? nil : line.id }) {
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        if Fixture.current != .noSource, Fixture.current != .ambiguousSource,
                           let t = line.timeLabel {
                            Text(t)
                                .font(.system(size: TypeScale.captionSize, design: .monospaced))
                                .foregroundStyle(Palette.muted(dark))
                                .frame(width: 38, alignment: .leading)
                        } else {
                            Text("·").foregroundStyle(Palette.muted(dark))
                        }
                        if Fixture.current != .noSource, let who = line.speaker {
                            Text(who)
                                .font(.system(size: TypeScale.microSize, weight: .semibold))
                                .foregroundStyle(Palette.accent(dark))
                        }
                        Text(line.text)
                            .font(.system(size: TypeScale.bodySize))
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
                    // misaligned: 行ごとに左端をずらす
                    .padding(.leading, Fixture.current == .misaligned ? CGFloat(idx % 3) * 17 : 0)

                    trustBand(line)
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
                .font(.system(size: TypeScale.secondarySize))
                .foregroundStyle(Palette.text(dark))
                .focused($focused)
                .onSubmit(ask)
                .accessibilityIdentifier("askAstraField")
            // よく頼むこと。入力欄と同じ場所に置く（右レールの別の箱にしない）。
            AIActionsPalette(state: state)
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
            // 窓の影は `AstraPanel`（`hasShadow`）が 1 段ぶん持つ。ここにも 0.17/30 を
            // 描いていたので実機では影が二重だった（撮影は窓の内側だけなので写らない）。
    }
}
