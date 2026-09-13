import Foundation

/// §11 画面をどれだけ見るかを**方針として 1 箇所に**置く。
///
/// 仕様書がわざわざ「常時 30fps キャプチャは禁止」と書いているのは、
/// 常時録画は機能ではなく監視になるから。既定は **0fps**（見ない）で、
/// 必要になった瞬間だけ 1 枚、視覚追跡が要る Agent のときだけ 1–3fps。
enum ScreenCapturePolicy {
    enum Need {
        /// 通常。画面は見ない。
        case idle
        /// 「この画面について聞く」。1 枚だけ。
        case snapshot
        /// 画面を追う Agent。1–3fps。
        case tracking
        /// 会議で必要なとき。上限は tracking と同じにする。
        case meeting
    }

    /// その用途で許される 1 秒あたりの枚数。**ここを超える取得はしない。**
    static func fps(for need: Need) -> Double {
        switch need {
        case .idle: return 0
        case .snapshot: return 0     // 連続では撮らない（単発なので fps ではない）
        case .tracking: return 3
        case .meeting: return 3
        }
    }

    /// 単発で 1 枚だけ撮ってよいか。
    static func allowsSingleShot(_ need: Need) -> Bool {
        need != .idle
    }

    /// 連続取得の最小間隔（秒）。0fps の用途では nil（＝連続取得しない）。
    static func minimumInterval(for need: Need) -> TimeInterval? {
        let f = fps(for: need)
        return f > 0 ? 1.0 / f : nil
    }
}
