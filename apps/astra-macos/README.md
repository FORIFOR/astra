# astra-macos

Astra の macOS ネイティブ UI（SwiftUI + AppKit）。UI/UX の正本はここ。
Tauri 版（`apps/desktop`）は機能の参照実装として残す（Phase E まで削除しない）。

## 動かす
```
swift build
swift run AstraMac                 # 通常（Voice OS ピル）
swift run AstraMac --demo recording      # 録音 Workspace（決定的な固定画面）
swift run AstraMac --demo recording-rag  # RAG ドロワーを開いた状態
swift run AstraMac --demo hud-listening  # 聞いています
swift run AstraMac --demo hud-thinking   # 考えています
```

`--demo` は §17 の Visual Regression 用に、経過時間・波形・transcript・位置を固定する。
