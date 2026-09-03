import SwiftUI

/// Home に残る会議 1 件。**録音ファイルの一覧にしない。**
///
/// 出すのは題・いつ・どれくらい・要約・人数・やること・決まったこと・保存先・project。
/// 尺とファイル名だけの行にすると、後から探すときに中身が分からない。
///
/// 同じカードが recording → processing → ready と姿を変える。止めたときに
/// 別のカードを作らないので、目で追える。
struct SessionCard: View {
    /// §10 Interface Size を変えたら描き直す（購読していないと変わらない）。
    @ObservedObject private var uiScale = UIScale.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let session: MeetingSession
    var onOpen: () -> Void = {}

    @ObservedObject private var store = MeetingSessionStore.shared
    @State private var showsProjects = false
    @State private var showsOverflow = false
    /// 録音中は経過を進める。
    @State private var tick = Date()
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: session.status == .ready ? 10 : 6) {
            header
            if session.status == .ready {
                readyBody
            } else {
                statusLine
            }
            footer
        }
        .padding(S.metric(Space.cardPadding))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(session.isLive ? Color.recordingRed.opacity(0.35) : Color.hairline(dark)))
        )
        .contentShape(Rectangle())
        .onTapGesture { if canOpen { onOpen() } }
        .onReceive(timer) { tick = $0 }
        .accessibilityIdentifier("session-\(session.id)")
        // 検査から「開けるか」を押す口。開けない状態では登録しない（押せたことにしない）。
        .onAppear { syncProbe() }
        .onChange(of: session.status) { _ in syncProbe() }
        .onDisappear { UIProbe.unregister("session-\(session.id)") }
    }

    /// 開ける状態か。落ちた録音も開ける —— 確定した行はその場で保存してあるので中身は残っている。
    /// 行き止まりのカードにしない。
    private var canOpen: Bool { session.status == .ready || session.status == .interrupted }
    private func syncProbe() {
        if canOpen { UIProbe.register("session-\(session.id)", onOpen) }
        else { UIProbe.unregister("session-\(session.id)") }
    }

    // MARK: - 上段

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            statusDot
            Text(session.title)
                .font(.system(size: S.type(TypeScale.cardTitleSize), weight: TypeScale.cardTitleWeight))
                .foregroundStyle(Palette.text(dark))
                .lineLimit(1)
            Spacer(minLength: 12)
            Text(session.isLive ? session.elapsedLabel(now: tick) : session.timeLabel())
                .font(.system(size: S.type(TypeScale.secondarySize),
                              design: session.isLive ? .monospaced : .default))
                .foregroundStyle(Palette.muted(dark))
        }
    }

    @ViewBuilder private var statusDot: some View {
        switch session.status {
        case .recording:
            Circle().fill(Color.recordingRed).frame(width: 8, height: 8)
        case .processing:
            // spinner だけにしない。下の行で何をしているかを言う。
            Circle().strokeBorder(Palette.accent(dark), lineWidth: 1.5)
                .frame(width: 8, height: 8)
        case .interrupted, .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 8))
                .foregroundStyle(Palette.warning(dark))
        case .ready:
            Circle().fill(Palette.muted(dark).opacity(0.4)).frame(width: 8, height: 8)
        }
    }

    /// recording / processing のときは簡潔に。
    private var statusLine: some View {
        // processing 中は段階を出す（spinner だけにしない）。
        Text(session.processingStage?.label ?? session.status.label)
            .font(.system(size: S.type(TypeScale.secondarySize)))
            .foregroundStyle(session.status == .interrupted || session.status == .failed
                             ? Palette.warning(dark) : Palette.muted(dark))
    }

    /// ready のときだけ情報量を増やす。
    private var readyBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let summary = session.summary, !summary.isEmpty {
                Text(summary)
                    .font(.system(size: S.type(TypeScale.bodySize)))
                    .foregroundStyle(Palette.text(dark))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // **ゼロが並ぶだけだと、成功か失敗か分からない。**
            // 終わった直後の会議が「0 人・やること 0・決まったこと 0・0 分」で、
            // 処理中なのか、何も拾えなかったのか、壊れたのかを見分けられない、と
            // 実装を知らない評価者 3 人が揃って言った。
            // 拾えたものが無いなら、数ではなく**言葉で**そう言う。
            if session.actionCount == 0 && session.decisionCount == 0 {
                HStack(spacing: 6) {
                    Image(systemName: "text.badge.xmark")
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.muted(dark))
                    Text((session.endedAt?.timeIntervalSince(session.startedAt) ?? 0) < 30
                         ? "短すぎて、拾えたものはありません"
                         : "拾えたものはありません")
                        .font(.system(size: S.type(TypeScale.secondarySize)))
                        .foregroundStyle(Palette.muted(dark))
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 14) {
                    if session.participantCount > 0 {
                        metric("person.2", "\(session.participantCount) 人")
                    }
                    metric("arrow.right.circle", "やること \(session.actionCount)")
                    metric("checkmark.circle", "決まったこと \(session.decisionCount)")
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func metric(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(Palette.muted(dark))
            Text(text).font(.system(size: S.type(TypeScale.secondarySize))).foregroundStyle(Palette.muted(dark))
        }
    }

    // MARK: - 下段（保存先 / project / overflow）

    private var footer: some View {
        HStack(spacing: 6) {
            // 保存先。録音中でも後からでも変えられる。別 window は出さない。
            Menu {
                ForEach(MeetingSession.Visibility.allCases, id: \.self) { v in
                    Button {
                        store.setVisibility(v, for: session.id)
                    } label: {
                        Text("\(v.label) — \(v.detail)")
                    }
                }
            } label: {
                chip(session.visibility.label, filled: session.visibility == .workspace)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityIdentifier("visibility-\(session.id)")

            // project。無ければ「プロジェクト無し」。
            Menu {
                Button("プロジェクト無し") { store.setProject(nil, for: session.id) }
                Divider()
                ForEach(Projects.all(), id: \.self) { p in
                    Button(p) { store.setProject(p, for: session.id) }
                }
            } label: {
                chip(session.projectId ?? "プロジェクト無し", filled: session.projectId != nil)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityIdentifier("project-\(session.id)")

            Spacer(minLength: 0)

            Menu {
                Button("開く") { onOpen() }
                Button("タイトルをコピー") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(session.title, forType: .string)
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(width: 28, height: 26)   // §16 hit area
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityIdentifier("overflow-\(session.id)")
        }
    }

    private func chip(_ text: String, filled: Bool) -> some View {
        Text(text)
            .font(.system(size: S.type(TypeScale.microSize), weight: .medium))
            .foregroundStyle(filled ? Palette.accent(dark) : Palette.muted(dark))
            .padding(.horizontal, 9)
            .frame(height: 22)
            .background(Capsule().fill(filled
                ? Palette.accent(dark).opacity(0.12)
                : Color.subtleFill(dark, 0.05)))
    }
}
