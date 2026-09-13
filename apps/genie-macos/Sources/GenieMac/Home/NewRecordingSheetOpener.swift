import SwiftUI

/// New Recording Sheet を外から開くためのつまみ。
///
/// 撮影（`--selftest sessionshots`）と、あとで他の導線（メニューなど）から
/// 同じ面を出せるようにしておく。View の中に閉じ込めると外から確かめられない。
@MainActor
final class NewRecordingSheetOpener: ObservableObject {
    static let shared = NewRecordingSheetOpener()
    @Published var isOpen = false
    func open() { isOpen = true }
    func close() { isOpen = false }
}
