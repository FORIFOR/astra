import Foundation
import Sparkle

/// 自動更新（Sparkle）。
///
/// 起動時に配布先の appcast を見て、新しい版があれば知らせる。落としてくるかどうかは
/// 利用者が決める（黙って入れ替えない）。
///
/// **設定が揃っていなければ動かさない。** appcast の URL と公開鍵のどちらかが
/// 欠けたまま Sparkle を起動すると、更新を確かめているつもりで何も見ていない、
/// あるいは検証なしに拾ってくる状態になる。「宣言だけあって繋がっていない」を作らない。
///
/// 必要なもの（どちらも Info.plist に入れる。梱包は `scripts/release-macos.sh`）:
///   - `SUFeedURL`      配布先に置く appcast.xml の URL（**https のみ**）
///   - `SUPublicEDKey`  `generate_keys` が出す公開鍵。秘密鍵は keychain に置く
@MainActor
final class SoftwareUpdate {
    static let shared = SoftwareUpdate()

    private var controller: SPUStandardUpdaterController?

    /// いま動いている版。バンドル外（`swift build` の実行体）では nil。
    static var currentVersion: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    /// 設定が揃っているか。揃っていない理由を返す（nil なら揃っている）。
    static func misconfiguration() -> String? {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let feed = info["SUFeedURL"] as? String, !feed.isEmpty else {
            return "SUFeedURL が無い（配布先が未設定）"
        }
        guard let url = URL(string: feed), url.scheme == "https" else {
            // http で配ると、途中で差し替えられたものを掴む。
            return "SUFeedURL が https でない"
        }
        guard let key = info["SUPublicEDKey"] as? String, !key.isEmpty else {
            return "SUPublicEDKey が無い（署名を検証できない）"
        }
        return nil
    }

    /// 起動時に一度だけ呼ぶ。設定が無ければ黙って何もしない（偽の「最新です」を出さない）。
    @discardableResult
    func startIfConfigured() -> Bool {
        guard controller == nil else { return true }
        guard Self.misconfiguration() == nil else { return false }
        // 落としてくるのは利用者が決める。起動直後に勝手に入れ替えない。
        controller = SPUStandardUpdaterController(
            startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        return true
    }

    /// 「更新を確認」から呼ぶ。設定が無いときは押せないようにしておくこと。
    func checkNow() {
        guard let controller else { return }
        controller.checkForUpdates(nil)
    }

    /// 設定が揃っていて、更新の確認ができる状態か。
    var isAvailable: Bool { controller != nil }
}
