// swift-tools-version:5.10
import PackageDescription
import Foundation

// Astra の macOS ネイティブ UI（正本）。共通ロジックは Rust の astra-core を UniFFI 経由で使う。
//   SwiftUI → AstraCoreBridge → AstraCore(UniFFI) → CAstraCoreFFI(C) → libastra_core.a(Rust)
// 生成物: `pnpm gen:swift-bindings`。Rust 静的ライブラリ: `cargo build`（core/astra-core）。
let package = Package(
    name: "astra-macos",
    platforms: [.macOS(.v14)],
    targets: [
        // UniFFI が出す C ヘッダ + modulemap（module 名 astra_coreFFI）。
        .target(name: "CAstraCoreFFI", path: "Sources/AstraCoreFFI", sources: [], publicHeadersPath: "include"),
        // UniFFI が出す Swift binding。Rust の静的ライブラリをここでリンクする。
        .target(
            name: "AstraCore",
            dependencies: ["CAstraCoreFFI"],
            path: "Sources/AstraCore",
            linkerSettings: [
                // **静的ライブラリを直に渡す。**
                //
                // 以前は `-L …/target/debug -lastra_core` だった。cargo は同じ場所へ
                // `.a` と `.dylib` の両方を置くので、リンカは `.dylib` を選ぶ。その結果
                // 配布用に署名した .app が、私のソースツリーの絶対パスにある debug の
                // dylib を参照して、他人の Mac では起動できない状態になっていた
                // （実際 `dist/Astra.app` が Team ID 不一致で落ちた）。
                // `.a` を位置引数で渡せば静的に取り込まれ、実行時に何も要らない。
                //
                // 置き場所は環境変数で差し替えられる。配布ビルドは release の `.a` を指す
                // —— 指せないと、release の .app に debug の Rust が入る。
                .unsafeFlags([
                    (ProcessInfo.processInfo.environment["ASTRA_CORE_LIB_DIR"]
                        ?? "../../core/astra-core/target/debug") + "/libastra_core.a",
                ])
            ]
        ),
        .executableTarget(
            name: "AstraMac",
            dependencies: ["AstraCore"],
            path: "Sources/AstraMac"
        ),
        .testTarget(
            name: "AstraMacTests",
            dependencies: ["AstraCore"],
            path: "Tests/AstraMacTests"
        ),
    ]
)
