import SwiftUI

/// 許可が無いまま録音が続いていることを、録音画面の中で伝える。
///
/// これまではマイク許可が無くても `NSLog` を出して**そのまま続けていた**。
/// 画面は「録音中 / 04:21 / 波形」と出るのに中身は無音——会議が終わってから
/// 気づく、いちばん高くつく壊れ方だった。止まっている理由と、直す場所を出す。
struct PermissionBanner: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        if let issue = state.permissionIssue {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.warning(dark))
                Text(issue.message)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button("設定を開く") { issue.open() }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.astraAccent(dark))
                    .frame(height: 28)          // §16 hit area
                    .padding(.horizontal, 8)
                    .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                    .accessibilityIdentifier("permissionOpenSettings")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Palette.warning(dark).opacity(dark ? 0.16 : 0.10))
            )
            .accessibilityIdentifier("permissionBanner")
        }
    }
}

/// 録音を成り立たなくしている許可。message は「何ができないか」を先に言う。
struct PermissionIssue {
    let message: String
    let open: () -> Void

    static var microphoneDenied: PermissionIssue {
        PermissionIssue(message: "マイクの許可が無いため、音声が記録されていません。") {
            Permissions.openMicrophoneSettings()
        }
    }
}
