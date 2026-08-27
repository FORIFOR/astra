// swift-tools-version:5.10
import PackageDescription

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
                .unsafeFlags([
                    "-L", "../../core/astra-core/target/debug",
                    "-lastra_core",
                ])
            ]
        ),
        .executableTarget(
            name: "AstraMac",
            dependencies: ["AstraCore"],
            path: "Sources/AstraMac"
        ),
    ]
)
