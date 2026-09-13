import SwiftUI

/// 設定 / 許可。ショートカット、声、そして OS 許可（マイク/画面/アクセシビリティ）の状態。
struct SettingsView: View {
    @State private var mic = Permissions.microphone
    @State private var screen = Permissions.screenRecording
    @State private var ax = Permissions.accessibility
    @State private var cal = Permissions.calendar
    @State private var input = Permissions.inputMonitoring
    @State private var speech = Permissions.speechRecognition
    @State private var showAdditionalPermissions: Bool

    init(showAdditionalPermissions: Bool = false) {
        _showAdditionalPermissions = State(initialValue: showAdditionalPermissions)
    }
    @ObservedObject private var practice = PermissionPractice.shared
    @State private var cloudTranscription = RecordingRuntime.cloudTranscriptionAllowed

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("設定").font(.system(size: 20, weight: .semibold))

            section("ショートカット") {
                // 実際に登録しているグローバルショートカットを正として出す（GlobalShortcut）。
                row(Facts.settingsShortcutRow, GlobalShortcut.label())
            }

            // §10 Interface Size。文字だけでなく面・余白も一緒に動く。
            section("表示の大きさ") {
                Picker("", selection: Binding(
                    get: { UIScale.shared.size },
                    set: { UIScale.shared.set($0) })) {
                    ForEach(UIScale.Size.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .accessibilityIdentifier("uiScale")
            }
            section(Facts.settingsPermissionsSection) {
                capabilityRow(.microphone, state: mic)
                capabilityRow(.screenCapture, state: screen)
                capabilityRow(.accessibility, state: ax)
            }
            DisclosureGroup("その他の許可", isExpanded: $showAdditionalPermissions) {
                permissionRow(Facts.permissionSpeechRecognition, speech, reason: "会議を手元で文字にするには\(Facts.permissionSpeechRecognition)の許可が要ります。",
                              request: { Permissions.requestSpeechRecognition { _ in speech = Permissions.speechRecognition } })
                permissionRow(Facts.permissionCalendar, cal, reason: PermissionCenter.Capability.schedule.reason,
                              request: { Permissions.requestCalendar { _ in cal = Permissions.calendar } })
                // ⌥Space はこの許可が無いと黙って効かない。Home が空のときしか直す道が無かった。
                permissionRow("\(Facts.permissionInputMonitoring)（\(GlobalShortcut.label())）", input,
                              reason: Facts.permissionInputMonitoringReason, request: {
                    if !Permissions.requestInputMonitoring() { Permissions.openInputMonitoringSettings() }
                    input = Permissions.inputMonitoring
                })
            }

            section("文字起こし") {
                Toggle("ライブ文字起こし（Google STT）", isOn: Binding(
                    get: { cloudTranscription },
                    set: { allowed in
                        cloudTranscription = allowed
                        RecordingRuntime.setCloudTranscriptionAllowed(allowed)
                    }))
                .toggleStyle(.switch)
                .accessibilityIdentifier("cloudTranscriptionToggle")
                Text(cloudTranscription
                     ? "録音中の音声をGoogleへ送り、字幕をリアルタイムに表示します。"
                     : "音声はこのMac内だけで処理します。Googleのライブ字幕を使うにはオンにします。")
                    .font(.system(size: 11)).foregroundStyle(.primary).opacity(0.78)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(practice.isReadingScreen ? "画面を1枚読み取り中です。外部には送信していません。" : "画面は必要なときだけ読み取ります。許可はmacOSの設定で変更できます。")
                .font(.system(size: 11)).foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
        .onChange(of: showAdditionalPermissions) { _, _ in SettingsWindowController.shared.resizeToContent() }
        .onAppear(perform: refreshPermissions)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in refreshPermissions() }
        .onReceive(NotificationCenter.default.publisher(for: SettingsWindowController.didShow)) { _ in refreshPermissions() }
        .onReceive(PermissionGuideCoordinator.shared.$state) { _ in refreshPermissions() }
    }

    private func capabilityRow(_ permission: GuidePermission, state: Permissions.State) -> some View {
        HStack(alignment: .center, spacing: Space.base) {
            Image(systemName: permission.symbol).frame(width: 20)
            VStack(alignment: .leading, spacing: Space.compact) {
                Text(permission.capabilityTitle).font(.system(size: S.type(TypeScale.secondarySize)))
                Text("macOS：" + permission.systemPermissionName)
                    .font(.system(size: S.type(TypeScale.captionSize))).foregroundStyle(.secondary)
            }
            Spacer(minLength: Space.compact)
            if state == .granted {
                Label("準備完了", systemImage: "checkmark")
                    .font(.system(size: S.type(TypeScale.captionSize))).foregroundStyle(.secondary)
            }
            Button(state == .granted ? "試す" : "有効にする") {
                if state == .granted { PermissionPractice.use(permission) }
                else { PermissionGuideCoordinator.shared.explain(permission) { PermissionPractice.use(permission) } }
            }
            .controlSize(.small)
            .accessibilityLabel(permission.capabilityTitle + (state == .granted ? "を試す" : "を有効にする"))
            .accessibilityIdentifier("permissionGuide-" + permission.rawValue)
        }.padding(.vertical, Space.compact)
    }

    private func refreshPermissions() {
        mic = Permissions.microphone; screen = Permissions.screenRecording
        ax = Permissions.accessibility; cal = Permissions.calendar
        input = Permissions.inputMonitoring; speech = Permissions.speechRecognition
        cloudTranscription = RecordingRuntime.cloudTranscriptionAllowed
    }

    private func section<C: View>(_ title: String, action: (() -> Void)? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                if let action {
                    Spacer()
                    Button("設定を案内…", action: action).controlSize(.small)
                        .help("アクセシビリティ・画面収録・マイクの設定を順に案内します")
                        .accessibilityIdentifier("settingsPermissionGuide")
                }
            }
            content()
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label).font(.system(size: 12)); Spacer()
            Text(value).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary) }
    }

    private func permissionRow(_ label: String, _ state: Permissions.State, reason: String,
                               guided: GuidePermission? = nil, request: @escaping () -> Void = {}) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12))
                // 理由は補足ではなく、許可を出すかを決める材料。薄い灰では読めない（盲検 3/3）。
                Text(reason).font(.system(size: 11)).foregroundStyle(.primary).opacity(0.78)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Text(state.rawValue).font(.system(size: 11))
                .foregroundStyle(state == .granted ? .green : .secondary)
            if state != .granted {
                Button(guided == nil ? Facts.permissionRequest : "設定を案内…") {
                    if let guided { PermissionGuideCoordinator.shared.explain(guided) { PermissionPractice.use(guided) } }
                    else { request() }
                }.controlSize(.small)
                    .accessibilityLabel("\(label)：\(guided == nil ? Facts.permissionRequest : "設定を案内")")
                    .accessibilityIdentifier(guided.map { "permissionGuide-\($0.rawValue)" } ?? "permission-\(label)")
            }
        }
    }
}
