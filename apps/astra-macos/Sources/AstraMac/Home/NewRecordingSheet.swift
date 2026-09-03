import SwiftUI

/// 設定を決めてから録るときの 1 枚。**Window は増やさない**（Home に重ねる）。
///
/// 毎回これを出さない。`Start recording` は前回設定でそのまま始まり、
/// ここは `⌄` を押したときだけ出る。
struct NewRecordingSheet: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @Binding var isPresented: Bool

    @AppStorage("astra.recording.systemAudio") private var systemAudio = true
    @AppStorage("astra.recording.template") private var template = "Meeting Notes"
    @AppStorage("astra.recording.visibility") private var visibilityRaw = MeetingSession.Visibility.mySpace.rawValue
    @AppStorage("astra.recording.project") private var project = ""

    private let templates = ["Meeting Notes", "1:1", "Interview", "Standup"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("新しい録音")
                .font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                .foregroundStyle(Palette.text(dark))
                .padding(.bottom, 18)

            row("Microphone", value: micName, ok: Permissions.microphone == .granted)
            row("System Audio", value: systemAudio ? "On" : "Off",
                ok: Permissions.screenRecording == .granted) {
                Toggle("", isOn: $systemAudio).labelsHidden().toggleStyle(.switch)
            }
            picker("Template", selection: $template, options: templates)
            picker("Save to", selection: Binding(
                get: { MeetingSession.Visibility(rawValue: visibilityRaw)?.label ?? "自分だけ" },
                set: { label in
                    visibilityRaw = (MeetingSession.Visibility.allCases.first { $0.label == label } ?? .mySpace).rawValue
                }), options: MeetingSession.Visibility.allCases.map(\.label))
            picker("Project", selection: Binding(
                get: { project.isEmpty ? "None" : project },
                set: { project = $0 == "None" ? "" : $0 }),
                options: ["None"] + Projects.all())

            Spacer(minLength: 0)

            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button(Facts.confirmationCancel) { isPresented = false }
                    .font(.system(size: TypeScale.bodySize))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(height: 36).padding(.horizontal, 18)
                    .buttonStyle(AstraControlStyle(radius: 9, base: 0.0))
                Button {
                    isPresented = false
                    start()
                } label: {
                    HStack(spacing: 7) {
                        Circle().fill(Color.recordingRed).frame(width: 8, height: 8)
                        Text(Facts.recordingStart)
                    }
                    .font(.system(size: TypeScale.bodySize, weight: .semibold))
                    .foregroundStyle(Palette.text(dark))
                    .frame(height: 36).padding(.horizontal, 20)
                }
                .buttonStyle(AstraControlStyle(radius: 9, base: 0.08))
                .accessibilityIdentifier("sheetStartRecording")
            }
        }
        .padding(26)
        .frame(width: 620, height: 400)
        .background(SheetSurface())
        .accessibilityIdentifier("newRecordingSheet")
    }

    private var micName: String {
        Permissions.microphone == .granted ? "MacBook Microphone" : "許可が要ります"
    }

    private func start() {
        let state = RecordingWorkspaceState.shared
        state.pendingCalendarLink = nil
        state.start()
        // 設定した保存先と project を、いま作られた Session へ反映する。
        if let live = MeetingSessionStore.shared.live {
            if let v = MeetingSession.Visibility(rawValue: visibilityRaw) {
                MeetingSessionStore.shared.setVisibility(v, for: live.id)
            }
            MeetingSessionStore.shared.setProject(project.isEmpty ? nil : project, for: live.id)
        }
    }

    @ViewBuilder
    private func row<Trailing: View>(_ title: String, value: String, ok: Bool,
                                     @ViewBuilder trailing: () -> Trailing = { EmptyView() }) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.system(size: TypeScale.bodySize))
                .foregroundStyle(Palette.muted(dark))
                .frame(width: 130, alignment: .leading)
            Text(value)
                .font(.system(size: TypeScale.bodySize))
                .foregroundStyle(ok ? Palette.text(dark) : Palette.warning(dark))
            Spacer(minLength: 0)
            trailing()
        }
        .frame(height: 44)
    }

    private func picker(_ title: String, selection: Binding<String>, options: [String]) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.system(size: TypeScale.bodySize))
                .foregroundStyle(Palette.muted(dark))
                .frame(width: 130, alignment: .leading)
            Picker("", selection: selection) {
                ForEach(options, id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .fixedSize()
            .accessibilityIdentifier("sheet-\(title)")
            Spacer(minLength: 0)
        }
        .frame(height: 44)
    }
}

/// Sheet の地。Dock と同じく操作 surface なので glass を使う。
private struct SheetSurface: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        shape
            .fill(.regularMaterial)
            .overlay(shape.fill(dark ? Color.black.opacity(0.24) : Color.white.opacity(0.5)))
            .overlay(shape.stroke(dark ? Color.white.opacity(0.12) : Color.black.opacity(0.07), lineWidth: 0.5))
    }
}
