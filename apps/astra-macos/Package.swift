// swift-tools-version:5.10
import PackageDescription

// Astra の macOS ネイティブ UI（正本）。Tauri 版は参照実装として残す。
// UI・Window・音声・画面キャプチャは Swift、Agent/RAG/DB などは既存 Rust を astra-core として後段で繋ぐ。
let package = Package(
    name: "astra-macos",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AstraMac",
            path: "Sources/AstraMac"
        )
    ]
)
