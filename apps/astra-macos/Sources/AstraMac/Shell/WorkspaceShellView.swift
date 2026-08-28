import SwiftUI

/// §7 Full Workspace Shell: sidebar / top bar / main canvas / inspector / composer。
/// §7.2 breakpoints で reflow する（AC-13）:
///   ≥1280: sidebar(208) + main + inspector(320) の 3-column
///   960–1279: inspector は drawer（常設しない）、sidebar は 64/208 切替可
///   720–959: sidebar collapsed(64)、main は single column
/// 寸法・閾値は tokens 由来（Metrics）。各 OS へ直書きしない。
enum ShellLayout: String {
    case threeColumn, inspectorDrawer, sidebarCollapsed
    /// 幅から §7.2 のレイアウトを決める純関数（テスト可能）。
    static func forWidth(_ w: CGFloat) -> ShellLayout {
        if w >= Metrics.bpThreeColumn { return .threeColumn }
        if w >= Metrics.bpInspectorDrawer { return .inspectorDrawer }
        return .sidebarCollapsed
    }
    var showsInspectorInline: Bool { self == .threeColumn }
    var sidebarWidth: CGFloat {
        self == .sidebarCollapsed ? Metrics.sidebarCollapsed : Metrics.sidebarWidth
    }
}

struct WorkspaceShellView<Main: View, Inspector: View>: View {
    @Environment(\.colorScheme) private var scheme
    var title: String
    var inspectorOpen: Bool = false      // drawer 時は明示的に開いた場合だけ出す
    @ViewBuilder var main: () -> Main
    @ViewBuilder var inspector: () -> Inspector
    private var dark: Bool { scheme == .dark }

    var body: some View {
        GeometryReader { geo in
            let layout = ShellLayout.forWidth(geo.size.width)
            HStack(spacing: 0) {
                sidebar(layout)
                Divider().overlay(Palette.border(dark))
                VStack(spacing: 0) {
                    topBar
                    Divider().overlay(Palette.border(dark))
                    HStack(spacing: 0) {
                        main().frame(minWidth: Metrics.mainMinWidth, maxWidth: .infinity, maxHeight: .infinity)
                        // 3-column のときだけ inspector を常設。狭いときは drawer（開いた時のみ）。
                        if layout.showsInspectorInline || (inspectorOpen && layout == .inspectorDrawer) {
                            Divider().overlay(Palette.border(dark))
                            inspector().frame(width: Metrics.inspectorWidth)
                                .background(Palette.surface(dark))
                        }
                    }
                    composer
                }
            }
            .background(Palette.canvas(dark))
        }
        .accessibilityIdentifier("workspaceShell")
    }

    private func sidebar(_ layout: ShellLayout) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(["Home", "Work", "Library", "Apps"], id: \.self) { s in
                HStack(spacing: 8) {
                    Circle().fill(Palette.accent(dark).opacity(0.5)).frame(width: 7, height: 7)
                    if layout != .sidebarCollapsed {   // collapsed(64) はアイコンのみ
                        Text(s).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark))
                    }
                }
            }
            Spacer()
        }
        .padding(Space.base)
        .frame(width: layout.sidebarWidth, alignment: .leading)
        .background(Palette.surface(dark))
    }

    private var topBar: some View {
        HStack {
            Text(title).font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                .foregroundStyle(Palette.text(dark))
            Spacer()
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.muted(dark))   // global search
            Image(systemName: "bell").foregroundStyle(Palette.muted(dark))
        }
        .padding(.horizontal, Space.cardPadding)
        .frame(height: Metrics.topBarHeight)
    }

    private var composer: some View {
        HStack {
            Text("Ask Astra…").font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            Spacer()
        }
        .padding(.horizontal, Space.cardPadding)
        .frame(height: Metrics.composerMinHeight)
        .background(Palette.surface(dark))
    }
}
