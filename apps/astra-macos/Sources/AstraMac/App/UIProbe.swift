import SwiftUI

/// 画面に実際に出ている操作を、検査から押せるようにする。
///
/// なぜ要るか: 「原文へ 1 クリックで戻れる」を宣言で確かめると、宣言だけ在って
/// 繋がっていない状態を見逃す。かといって自プロセスの AX は子を返さないので
/// （AXApplication の AXChildren が空。調べた）、押す経路がここしか無い。
///
/// **押されたときに走るものは view と同じ 1 本**にしてある（`ProbeButton`）。
/// 検査用の別実装を持たせると、それこそ「宣言だけ」に戻る。
///
/// 測れないもの: 実際のマウス当たり判定と、その部品が他に隠れていないこと。
/// これは画面の絵で見る（`docs/golden-screenshots`）。
enum UIProbe {
    private static var actions: [String: () -> Void] = [:]

    static func register(_ id: String, _ run: @escaping () -> Void) { actions[id] = run }
    static func unregister(_ id: String) { actions[id] = nil }

    /// 出ているか。出ていないものを押せたことにしない。
    static func exists(_ id: String) -> Bool { actions[id] != nil }

    /// 押す。出ていなければ false。
    @discardableResult
    static func tap(_ id: String) -> Bool {
        guard let run = actions[id] else { return false }
        run()
        return true
    }

    /// いま出ている目印（調査用）。
    static var visible: [String] { actions.keys.sorted() }
}

/// 目印付きのボタン。押すと走るものは 1 本だけで、検査もそれを押す。
struct ProbeButton<Label: View>: View {
    let id: String
    let action: () -> Void
    @ViewBuilder let label: () -> Label

    var body: some View {
        Button(action: action, label: label)
            .onAppear { UIProbe.register(id, action) }
            .onDisappear { UIProbe.unregister(id) }
            .accessibilityIdentifier(id)
    }
}
