import SwiftUI

/// §8 Home: KPI dashboard ではなく「今必要な仕事への入口」。greeting + intent、Attention 最大3、Active work、Recent。
/// 寸法/色/余白は tokens 由来（Palette/TypeScale/Space）。KPI は常設しない（§8.1）。
struct HomeAttention: Identifiable {
    let id = UUID()
    let kind: String
    let title: String
    let action: String
    /// 予定から録るときに引き継ぐもの（無ければ予定なし録音と同じ扱い）。
    var link: CalendarLink?
}
struct HomeWork: Identifiable { let id = UUID(); let title: String; let meta: String }

struct HomeView: View {
    /// §10 Interface Size を変えたら描き直す（購読していないと変わらない）。
    @ObservedObject private var uiScale = UIScale.shared
    @Environment(\.colorScheme) private var scheme
    /// 既定は時刻から作る。以前は "Good morning" 固定で、夜に開いても朝の挨拶を返し、
    /// 日本語の画面に 1 行だけ英語が混ざっていた（実機の 18 時台の撮影で判明）。
    var greeting: String = HomeView.greetingForNow()
    var attention: [HomeAttention] = []
    var active: [HomeWork] = []
    private var dark: Bool { scheme == .dark }
    @State private var intent = ""
    /// 実データ。無ければその節ごと出さない。
    @State private var recentTasks: [AgentTask] = []
    @State private var recordedCount = 0
    @State private var pluginCount = 0
    /// 復旧を押したあとの返事。押して何も起きないように見せない。
    @State private var recoverNote = ""
    /// ⌥Space の許可を求めたあとか。求めた直後は、次にどこを見ればよいか言う。
    @State private var inputMonitoringAsked = false
    @ObservedObject private var voice = VoiceHUDState.shared
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var sessions = MeetingSessionStore.shared
    @ObservedObject private var sheetOpener = NewRecordingSheetOpener.shared
    @FocusState private var intentFocused: Bool

    static func greetingForNow(_ date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<11: return "おはようございます"
        case 11..<18: return "こんにちは"
        default: return "こんばんは"
        }
    }

    var body: some View {
        ZStack {
            homeBody
            // §4 New Recording は Home に**重ねて**出す。window を増やさない。
            if sheetOpener.isOpen {
                Color.black.opacity(0.24)
                    .ignoresSafeArea()
                    .onTapGesture { sheetOpener.close() }
                NewRecordingSheet(isPresented: Binding(
                    get: { sheetOpener.isOpen },
                    set: { sheetOpener.isOpen = $0 }))
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    .shadow(color: .black.opacity(dark ? 0.5 : 0.22), radius: 40, y: 16)
            }
        }
        .animation(.easeOut(duration: 0.14), value: sheetOpener.isOpen)
    }

    private var homeBody: some View {
        GeometryReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: S.metric(Space.largePadding)) {
                // §2 Home の順序: Recording now → Upcoming → Recent Sessions
                if let live = sessions.live {
                    RecordingNowCard(session: live)
                }

                // 録音中は挨拶を出さない。いま起きていることの下で「おはようございます」と
                // 言われても意味が無いし、画面の主役が挨拶に見えてしまう。
                if sessions.live == nil {
                    Text(greeting)
                        .font(.system(size: S.type(TypeScale.pageTitleSize), weight: TypeScale.pageTitleWeight))
                        .foregroundStyle(Palette.text(dark))
                }

                intentField
                answerLine

                if sessions.live == nil {
                    StartRecordingCard()
                }

                // 直近の録りかけは**予定より先**に出す。落ちた直後に気づけることが
                // この札の目的なので、Upcoming と Recent の間に挟まっていると
                // 「割り込み」でしかなくなる。
                if recordedCount > 0 && hasRecentRecoverable {
                    recoverableRow
                }

                if !attention.isEmpty {
                    section("Upcoming")
                    ForEach(attention.prefix(3)) { a in
                        upcomingRow(a)
                    }
                }

                if !sessions.recent.isEmpty {
                    section("Recent Sessions")
                    ForEach(sessions.recent.prefix(6)) { s in
                        SessionCard(session: s) { openDetail(s) }
                    }
                }

                // 頼んだ仕事。**DB から読んでいたのに、どこにも出していなかった。**
                if !recentTasks.isEmpty {
                    section("Recent Work")
                    ForEach(recentTasks.prefix(5)) { t in
                        taskRow(t)
                    }
                }

                // 古い録りかけは**いちばん下**。急ぐものではないので、
                // 予定や直近の会議より前に置かない。
                if recordedCount > 0 && !hasRecentRecoverable {
                    recoverableRow
                }

                // 録音中は「何もありません」ではない。live を recent から外したので、
                // ここも live を見ないと、録音カードの真下で「今日はまだ何もありません」と
                // 言うことになる。
                if attention.isEmpty && sessions.recent.isEmpty && sessions.live == nil && recentTasks.isEmpty && recordedCount == 0 {
                    // 中央に浮かせない。上の操作の続きとして、左揃えで置く。
                    // 虚空の真ん中に文字があると、余白が「空き」に見えて落ち着かない。
                    VStack(alignment: .leading, spacing: 6) {
                        Text("まだ何もありません")
                            .font(.system(size: S.type(TypeScale.bodySize), weight: .medium))
                            .foregroundStyle(Palette.text(dark))
                        // 次にすることを 1 つだけ書く。説明はしない。
                        //
                        // ただし ⌥Space が**実際に効かない**なら、そう言わない。
                        // 効かせるための許可は、この案内を押したときに求める
                        // —— 起動した瞬間に出すと、まだ何も使っていない人に
                        // 判断を迫ることになる（Apple も、機能を使う瞬間まで
                        // 待つよう勧めている）。
                        if Permissions.inputMonitoring == .granted {
                            Text("⌥Space でどこからでも始められます")
                                .font(.system(size: S.type(TypeScale.secondarySize)))
                                .foregroundStyle(Palette.muted(dark))
                        } else {
                            Button {
                                Permissions.requestInputMonitoring()
                                inputMonitoringAsked = true
                            } label: {
                                HStack(spacing: 5) {
                                    Text("⌥Space を使えるようにする")
                                    Image(systemName: "arrow.right")
                                        .font(.system(size: 10, weight: .semibold))
                                }
                                .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                                .foregroundStyle(Palette.accent(dark))
                                .frame(height: 28)
                            }
                            .buttonStyle(AstraControlStyle(radius: 7, base: 0.0))
                            .accessibilityIdentifier("askInputMonitoring")
                            if inputMonitoringAsked {
                                Text("システム設定で Astra を許可してください")
                                    .font(.system(size: S.type(TypeScale.microSize)))
                                    .foregroundStyle(Palette.muted(dark))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                Spacer(minLength: 0)
            }
            .padding(S.metric(Space.largePadding))
            // 本文の幅を絞る。1400pt に 1 行が伸びると、書類ではなく表に見える。
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: proxy.size.height, alignment: .top)
        }
        .background(Palette.canvas(dark))
        .accessibilityIdentifier("homeView")
        }
        .onAppear(perform: loadReal)
    }

    private func openDetail(_ session: MeetingSession) {
        MainNav.shared.openSession = session.id
        MainNav.shared.section = .meetings
    }

    /// 入力欄の見た目をして**入力できない**ラベルだった（実機で判明）。
    /// 本物の TextField にし、Enter で Voice HUD と同じ依頼経路へ送る。
    private var intentField: some View {
        HStack(spacing: 10) {
            TextField("何を終わらせますか？", text: $intent)
                .textFieldStyle(.plain)
                .font(.system(size: S.type(TypeScale.bodySize)))
                .foregroundStyle(Palette.text(dark))
                .focused($intentFocused)
                .onSubmit(submitIntent)
                .accessibilityIdentifier("homeIntentField")
            Button { VoiceHUDState.shared.beginListening() } label: {
                Image(systemName: "mic").foregroundStyle(Palette.muted(dark))
                    .frame(width: 28, height: 28)   // §16 hit area
            }
            .buttonStyle(AstraControlStyle(radius: 8, filled: false))
            .accessibilityIdentifier("homeIntentMic")
        }
        .padding(.horizontal, S.metric(Space.cardPadding)).frame(height: 48)
        .background(RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous)
            .fill(Palette.surface(dark)).overlay(RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous)
                .stroke(intentFocused ? Palette.accent(dark) : Palette.border(dark),
                        lineWidth: intentFocused ? Metrics.focusRing : 1)))
        .onTapGesture { intentFocused = true }
    }

    /// 依頼の途中と結果をその場に返す（押した先が見えないと不安になる）。
    @ViewBuilder private var answerLine: some View {
        if voice.mode == .thinking || !voice.answer.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: voice.mode == .thinking ? "ellipsis" : "sparkles")
                    .font(.system(size: 11)).foregroundStyle(Palette.accent(dark))
                Text(voice.mode == .thinking ? "考えています…" : voice.answer)
                    .font(.system(size: S.type(TypeScale.secondarySize)))
                    .foregroundStyle(Palette.text(dark))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(S.metric(Space.cardPadding))
            .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous)
                .fill(Palette.surface(dark)))
            .accessibilityIdentifier("homeIntentAnswer")
        }
    }

    private func loadReal() {
        recentTasks = LocalStore.shared.loadTasks()
        recordedCount = RecordingRuntime.shared.recoverableMeetings().count
        PluginRuntimeStore.shared.load()
        pluginCount = PluginRuntimeStore.shared.manifests.count
    }

    private func submitIntent() {
        let text = intent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        intent = ""
        VoiceHUDState.shared.ask(text)
    }

    /// 節の見出し。**中身より小さく静かに**する。以前は 22pt で、行より目立っていた。
    /// 録りかけを捨てる。**音が消えて戻せない**ので、必ず一度聞く（§16 R3）。
    private func discardPending() {
        let all = RecordingRuntime.shared.recoverableMeetings()
        guard !all.isEmpty else { recordedCount = 0; return }
        let go = Confirm.ask(ActionConfirmation(
            title: "録りかけ \(all.count) 件を捨てます",
            details: ["録音した音が消えます。戻せません",
                      "読み取りたいものがあるなら、先に「続きから」を試してください"],
            risk: .r3,
            confirmLabel: "\(all.count) 件を捨てる"))
        guard go else { return }
        RecoveryState.shared.pending = all
        let n = RecoveryState.shared.discardAll()
        recordedCount = RecordingRuntime.shared.recoverableMeetings().count
        recoverNote = recordedCount == 0 ? "\(n) 件を捨てました。" : "\(n) 件を捨てました（\(recordedCount) 件残っています）。"
    }

    /// 溜まっていた録りかけを片付ける。送れなかったときは黙らずに理由を返す。
    private func recoverPending() {
        RecoveryState.shared.pending = RecordingRuntime.shared.recoverableMeetings()
        let sent = RecoveryState.shared.recoverAll()
        let after = RecordingRuntime.shared.recoverableMeetings().count
        recordedCount = after
        // サインインしていないと送り先が無い。押しても何も起きないように見せない。
        recoverNote = sent > 0
            ? "\(recordedCount == 0 ? "すべて" : "一部を")読み取りました。"
            : "送り先がまだありません。サインインすると続きから読み取れます。"
    }

    /// 直近の録りかけがあるか（7 日以内）。
    ///
    /// 古いものまで警告色で出し続けると、ただの雑音になる。落ちた直後に気づける
    /// ことが大事なのであって、3 週間前の断片を毎朝知らせても誰も助からない。
    private var hasRecentRecoverable: Bool {
        let week: TimeInterval = 7 * 24 * 60 * 60
        let now = Date().timeIntervalSince1970
        return RecordingRuntime.shared.recoverableMeetings().contains { m in
            guard let started = TimeInterval(m.startedAt) else { return true }  // 読めないものは新しい扱い
            return now - started <= week
        }
    }

    /// 保存し切れていない録音がある、という報せ。件数だけ出して押せば続きへ。
    private var recoverableRow: some View {
        let recent = hasRecentRecoverable
        return HStack(spacing: 10) {
            Image(systemName: "arrow.counterclockwise.circle")
                .font(.system(size: 13))
                .foregroundStyle(recent ? Palette.warning(dark) : Palette.muted(dark))
            VStack(alignment: .leading, spacing: 2) {
                Text(recent
                     ? "録りかけが \(recordedCount) 件あります"
                     : "古い録りかけが \(recordedCount) 件残っています")
                    .font(.system(size: S.type(TypeScale.bodySize),
                                  weight: recent ? .medium : .regular))
                    .foregroundStyle(recent ? Palette.text(dark) : Palette.muted(dark))
                Text(recoverNote.isEmpty
                     ? (recent
                        ? "前回、保存し切る前に終わった録音です。続きから読み取れます。"
                        : "1 週間より前のものです。要らなければ破棄できます。")
                     : recoverNote)
                    .font(.system(size: S.type(TypeScale.secondarySize)))
                    .foregroundStyle(Palette.muted(dark))
            }
            Spacer(minLength: 0)
            // 件数を出すだけで手が無いと、毎回同じ数を見せられるだけになる。
            Button("続きから") { recoverPending() }
                .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                .foregroundStyle(Palette.accent(dark))
                .frame(height: 30).padding(.horizontal, 12)
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
                .accessibilityIdentifier("recoverPending")
            // **捨てる道**。送り先が無ければ「続きから」は何もできないので、
            // これが無いと消せないお知らせを永久に見続けることになる。
            Button("破棄") { discardPending() }
                .font(.system(size: S.type(TypeScale.secondarySize)))
                .foregroundStyle(Palette.muted(dark))
                .frame(height: 30).padding(.horizontal, 10)
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                .accessibilityIdentifier("discardPending")
        }
        .padding(S.metric(Space.cardPadding))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(recent ? Palette.warning(dark).opacity(dark ? 0.12 : 0.07)
                             : Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(recent ? Palette.warning(dark).opacity(0.3) : Color.hairline(dark))))
        .accessibilityIdentifier("recoverableRecordings")
    }

    /// 頼んだ仕事 1 件。いつ・どこまで・どうなったか。
    private func taskRow(_ t: AgentTask) -> some View {
        HStack(spacing: 10) {
            Image(systemName: taskIcon(t.status))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(taskTint(t.status))
                .frame(width: 14)
            Text(t.title)
                .font(.system(size: S.type(TypeScale.bodySize)))
                .foregroundStyle(Palette.text(dark))
                .lineLimit(1)
            Spacer(minLength: 12)
            if !t.steps.isEmpty {
                Text("\(t.steps.filter { $0.state == .success }.count)/\(t.steps.count)")
                    .font(.system(size: S.type(TypeScale.microSize), design: .monospaced))
                    .foregroundStyle(Palette.muted(dark))
            }
            Text(t.startedAt.formatted(date: .omitted, time: .shortened))
                .font(.system(size: S.type(TypeScale.microSize)))
                .foregroundStyle(Palette.muted(dark))
        }
        .padding(.horizontal, S.metric(Space.cardPadding))
        .frame(height: 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.hairline(dark))))
        .accessibilityIdentifier("homeTask-\(t.title)")
    }

    private func taskIcon(_ s: AgentRunState) -> String {
        switch s {
        case .success: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .running: return "circle.dotted"
        case .pending: return "circle"
        }
    }

    private func taskTint(_ s: AgentRunState) -> Color {
        switch s {
        case .success: return Palette.accent(dark)
        case .failed: return Palette.warning(dark)
        case .running, .pending: return Palette.muted(dark)
        }
    }

    private func section(_ t: String) -> some View {
        Text(t)
            .font(.system(size: S.type(TypeScale.microSize), weight: .semibold))
            .foregroundStyle(Palette.muted(dark))
            .tracking(0.4)
            .padding(.top, 6)
    }
    /// 予定の行。[Record] を押したらその場で録音が始まる（毎回設定を出さない）。
    private func upcomingRow(_ a: HomeAttention) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(Palette.muted(dark))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.title)
                    .font(.system(size: S.type(TypeScale.cardTitleSize), weight: TypeScale.cardTitleWeight))
                    .foregroundStyle(Palette.text(dark))
                Text(a.kind).font(.system(size: S.type(TypeScale.secondarySize))).foregroundStyle(Palette.muted(dark))
            }
            Spacer(minLength: 12)
            Button {
                // §6 予定から録ると、題・人数・URL・project を引き継ぐ。
                RecordingWorkspaceState.shared.pendingCalendarLink = a.link
                RecordingWorkspaceState.shared.start()
            } label: {
                HStack(spacing: 5) {
                    Circle().fill(Color.recordingRed).frame(width: 7, height: 7)
                    Text("Record").font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                }
                .foregroundStyle(Palette.text(dark))
                .frame(height: 30).padding(.horizontal, 12)
            }
            .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
            .accessibilityIdentifier("record-\(a.title)")
        }
        .padding(S.metric(Space.cardPadding))
        .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
    }

    private func row(icon: String, accent: Color, title: String, sub: String, action: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: S.type(TypeScale.cardTitleSize), weight: TypeScale.cardTitleWeight)).foregroundStyle(Palette.text(dark))
                Text(sub).font(.system(size: S.type(TypeScale.secondarySize))).foregroundStyle(Palette.muted(dark))
            }
            Spacer()
            if let action { Text(action).font(.system(size: S.type(TypeScale.secondarySize), weight: .medium)).foregroundStyle(Palette.accent(dark)) }
        }
        .padding(S.metric(Space.cardPadding))
        .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
    }
}
