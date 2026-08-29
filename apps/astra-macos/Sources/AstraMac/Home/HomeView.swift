import SwiftUI

/// §8 Home: KPI dashboard ではなく「今必要な仕事への入口」。greeting + intent、Attention 最大3、Active work、Recent。
/// 寸法/色/余白は tokens 由来（Palette/TypeScale/Space）。KPI は常設しない（§8.1）。
struct HomeAttention: Identifiable { let id = UUID(); let kind: String; let title: String; let action: String }
struct HomeWork: Identifiable { let id = UUID(); let title: String; let meta: String }

struct HomeView: View {
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
    @ObservedObject private var voice = VoiceHUDState.shared
    @ObservedObject private var store = AstraStateStore.shared
    @FocusState private var intentFocused: Bool

    static func greetingForNow(_ date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<11: return "おはようございます"
        case 11..<18: return "こんにちは"
        default: return "こんばんは"
        }
    }

    var body: some View {
        GeometryReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: Space.largePadding) {
                // 録音中は Home の一番上でそれが分かる。録音のために画面を切り替えさせない。
                if store.state.meeting.isRecording {
                    RecordingNowBanner()
                }
                Text(greeting)
                    .font(.system(size: TypeScale.pageTitleSize, weight: TypeScale.pageTitleWeight))
                    .foregroundStyle(Palette.text(dark))

                // universal intent（§8: 中央の入力。KPI ではなく依頼の入口）
                // 入力欄の見た目をして**入力できない**ラベルだった（実機で判明）。
                // 本物の TextField にし、Enter で Voice HUD と同じ依頼経路へ送る。
                HStack(spacing: 10) {
                    TextField("何を終わらせますか？", text: $intent)
                        .textFieldStyle(.plain)
                        .font(.system(size: TypeScale.bodySize))
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
                .padding(.horizontal, Space.cardPadding).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous)
                    .fill(Palette.surface(dark)).overlay(RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous)
                        .stroke(intentFocused ? Palette.accent(dark) : Palette.border(dark),
                                lineWidth: intentFocused ? Metrics.focusRing : 1)))
                .onTapGesture { intentFocused = true }

                // 依頼の途中と結果をその場に返す（押した先が見えないと不安になる）。
                if voice.mode == .thinking || !voice.answer.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: voice.mode == .thinking ? "ellipsis" : "sparkles")
                            .font(.system(size: 11)).foregroundStyle(Palette.accent(dark))
                        Text(voice.mode == .thinking ? "考えています…" : voice.answer)
                            .font(.system(size: TypeScale.secondarySize))
                            .foregroundStyle(Palette.text(dark))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(Space.cardPadding)
                    .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous)
                        .fill(Palette.surface(dark)))
                    .accessibilityIdentifier("homeIntentAnswer")
                }

                if !attention.isEmpty {
                    section("Attention")
                    ForEach(attention.prefix(3)) { a in // §8.1 最大3件
                        // 予定からそのまま録り始められる。設定画面は挟まない。
                        upcomingRow(a)
                    }
                }
                // 実際にこの Mac にあるものを出す。架空の行は作らない。
                if !recentTasks.isEmpty {
                    section("最近の仕事")
                    ForEach(recentTasks.prefix(3)) { t in
                        row(icon: t.status == .success ? "checkmark.circle" : "circle.fill",
                            accent: t.status == .success ? Palette.success(dark) : Palette.accent(dark),
                            title: t.title,
                            sub: "\(t.steps.filter { $0.state == .success }.count)/\(t.steps.count) 段",
                            action: nil)
                    }
                }
                if recordedCount > 0 {
                    section("この Mac の録音")
                    row(icon: "waveform", accent: Palette.accent(dark),
                        title: "\(recordedCount) 件の会議が残っています",
                        sub: "音声は端末から出ません", action: nil)
                }
                if pluginCount > 0 {
                    section("できること")
                    row(icon: "square.grid.2x2", accent: Palette.muted(dark),
                        title: "\(pluginCount) 個のプラグイン",
                        sub: "許可した権限の中でだけ動きます", action: nil)
                }

                if attention.isEmpty && active.isEmpty && recentTasks.isEmpty
                    && recordedCount == 0 && pluginCount == 0 {
                    // §8.1: 空状態では機能説明を並べず、頼み方を 1 行だけ示す。
                    // 入力欄の直下に貼り付くと「途中で切れた画面」に見えたので、
                    // 残りの高さの中央に置く（下の Spacer と対にする）。
                    Spacer(minLength: 0)
                    VStack(spacing: 6) {
                        Text("今日はまだ何もありません。")
                            .font(.system(size: TypeScale.bodySize))
                            .foregroundStyle(Palette.text(dark))
                        Text("面倒なことを 1 つ頼んでください。")
                            .font(.system(size: TypeScale.secondarySize))
                            .foregroundStyle(Palette.muted(dark))
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, Space.largePadding)
                }
                if !active.isEmpty {
                    section("Active work")
                    ForEach(active) { w in
                        row(icon: "circle.fill", accent: Palette.accent(dark), title: w.title, sub: w.meta, action: nil)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(Space.largePadding)
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
    private func section(_ t: String) -> some View {
        Text(t)
            .font(.system(size: TypeScale.microSize, weight: .semibold))
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
                    .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                    .foregroundStyle(Palette.text(dark))
                Text(a.kind).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            }
            Spacer(minLength: 12)
            Button {
                RecordingWorkspaceState.shared.start()
            } label: {
                HStack(spacing: 5) {
                    Circle().fill(Color.recordingRed).frame(width: 7, height: 7)
                    Text("Record").font(.system(size: TypeScale.secondarySize, weight: .medium))
                }
                .foregroundStyle(Palette.text(dark))
                .frame(height: 30).padding(.horizontal, 12)
            }
            .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
            .accessibilityIdentifier("record-\(a.title)")
        }
        .padding(Space.cardPadding)
        .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
    }

    private func row(icon: String, accent: Color, title: String, sub: String, action: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight)).foregroundStyle(Palette.text(dark))
                Text(sub).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            }
            Spacer()
            if let action { Text(action).font(.system(size: TypeScale.secondarySize, weight: .medium)).foregroundStyle(Palette.accent(dark)) }
        }
        .padding(Space.cardPadding)
        .background(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Metrics.paletteRadius, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
    }
}
