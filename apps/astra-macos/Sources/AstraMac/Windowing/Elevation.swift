import AppKit

/// 造形⑧ 面がどれだけ浮いているか。
///
/// **大きさではなく、画面の縁に接しているかで決まる。**
///
/// ```text
/// attached  画面の縁から生えている   Dock（全状態）      影なし
/// floating  desktop の上に置かれた   Workspace / Main    影あり
/// ```
///
/// 最初は「小さい面は接している / 広がった面は浮く」と考えて、Dock の中で
/// 状態ごとに切り替えるつもりだった。3 人に伏せて見せたら、**広がった面でも
/// 影なしが 3/3**。agent の面も同じ Dock が下へ伸びたもので、上辺は画面の縁の
/// ままなので当然だった。分かれ目は大きさではなく、接しているかどうか。
/// （`docs/ux-benchmark/auto/CRAFT.md` ⑧）
///
/// ここでやるのは `NSWindow.hasShadow` の切り替えだけ。**自前の影は描かない。**
/// 素材・alpha・影は macOS で副作用が出やすく、`DockSurface` の註のとおり
/// SwiftUI の `.shadow` は外形ではなくレイヤの矩形から落ちる。
enum Elevation {
    case attached
    case floating

    var wantsShadow: Bool { self == .floating }

    /// 比べ直すための上書き。既定は面の性質どおり。
    static func apply(to panel: NSWindow, _ kind: Elevation) {
        let want: Bool
        switch ProcessInfo.processInfo.environment["ASTRA_ELEVATION"] {
        case "all": want = true
        case "none": want = false
        default: want = kind.wantsShadow
        }
        guard panel.hasShadow != want else { return }
        panel.hasShadow = want
        // 形が変わったときと同じで、切り替えたら計算し直す。
        panel.invalidateShadow()
    }
}
