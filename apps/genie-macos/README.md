# genie-macos

Genie の macOS ネイティブ UI（SwiftUI + AppKit）。UI/UX の正本はここ。
Tauri 版（`apps/desktop`）は機能の参照実装として残す（Phase E まで削除しない）。

## 動かす
```
swift build
swift run GenieMac                 # 通常（Voice OS ピル）
swift run GenieMac --demo recording      # 録音 Workspace（決定的な固定画面）
swift run GenieMac --demo recording-rag  # RAG ドロワーを開いた状態
swift run GenieMac --demo hud-listening  # 聞いています
swift run GenieMac --demo hud-thinking   # 考えています
```

`--demo` は §17 の Visual Regression 用に、経過時間・波形・transcript・位置を固定する。
