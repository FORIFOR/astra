import SwiftUI

/// 録音中の 1 枚。外枠だけ Shape、中身は**構造化レイアウト**（絶対座標を使わない）。
/// 上辺の凹みに Task Dock を ZStack で重ねる（Workspace の内側には入れない）。
///
/// 以前は `.position(x:120,y:300)` のような絶対配置でカードを浮かせており、
/// ①視線が定まらない ②RAG を開くと他のカードを**切ってしまう** という実機で見える破綻があった。
/// いまは「左: 録音の主役＋AI 操作 / 右: 文字起こし列 / 下: RAG バー」の 3 区画に固定し、
/// 余白・列幅・ドロワー高さは **すべて tokens（Metrics.ws*）** から取る。
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

            HStack(alignment: .top, spacing: Metrics.wsColumnGap) {
                // 左: 録音の主役 → AI 操作。視線が上から下へ一本で流れる。
                //
                // 結果がまだ無いときは列ごと**上下中央**に置く。上詰めだと下に 260pt の
                // 空白が残り（実機で確認）、右の全高カードと釣り合わず構図が上に寄って見えた。
                // 結果が出たら上詰めへ切り替え、面が下へ伸びられるようにする。
                VStack(spacing: 18) {
                    if !hasAIOutput { Spacer(minLength: 0) }
                    RecordingHeroView(state: state)
                    PermissionBanner(state: state)
                    AIActionsPalette(state: state)
                    // 押した結果はここに出る。走っていない/結果が無いときは何も置かない。
                    AIResultPanel(state: state)
                    Spacer(minLength: 0)
                }
                .padding(.top, hasAIOutput ? 18 : 0)
                .frame(maxWidth: .infinity)
                .animation(.easeOut(duration: Motion.drawerMs), value: hasAIOutput)

                // 右: いま見ている中身（文字起こし / 翻訳 / 字幕）。切替は同じ列の上に置く。
                VStack(spacing: 10) {
                    RecordingToolPalette(selection: $state.selectedTool)
                    TranscriptPanel(state: state)
                    Spacer(minLength: 0)
                }
                .frame(width: Metrics.wsRightColumn)
            }
            .padding(.horizontal, Metrics.wsGutter)
            .frame(maxHeight: .infinity)

            // 下: RAG。閉じているときは 1 本のバー、開くとこの区画だけが伸びる。
            // 他のカードの上に**かぶせない**ので、開いても画面が破綻しない。
            ragSection
        }
        .frame(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight)
    }

    /// AI の結果が出ているか（左列を中央寄せにするか上詰めにするかの分かれ目）。
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
                    Image(systemName: "plus")
                    Text("RAG")
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.astraAccent)
                // 小さい字でも押せる面を確保する（UI/UX 仕様 §16: hit area 28〜32pt）。
                .frame(height: Metrics.wsBottomBar)
                .padding(.horizontal, 14)
            }
            .buttonStyle(AstraControlStyle(radius: 10, base: 0.0))
            .accessibilityIdentifier("ragToggle")
            .keyboardShortcut("r", modifiers: [.command])
            .padding(.bottom, Metrics.wsGutter - 8)
        }
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
