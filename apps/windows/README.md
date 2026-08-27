# Astra for Windows（WinUI 3 + C#）— 雛形

macOS(`apps/astra-macos`) と**同じ Design Spec**（`shared/design/tokens.json`）から
`GeneratedMetrics.cs` を生成し、WinUI 3 でネイティブに描く。ロジックは共通 Rust コア（後段で UniFFI / C ABI）。

**状態: 未ビルド。** この開発機は macOS のため WinUI 3 / Windows App SDK をビルド・検証できない。
ここにあるのは構造と生成物と設計メモのみ。実ビルドは Windows + Visual Studio / `dotnet` で行う。

## 対応表（macOS ↔ Windows）
| 役割 | macOS | Windows |
| --- | --- | --- |
| 浮遊窓 | NSPanel | AppWindow + OverlappedPresenter（IsAlwaysOnTop / SetBorderAndTitleBar(false,false)） |
| すりガラス | NSVisualEffectView | Window.SystemBackdrop = DesktopAcrylicBackdrop |
| 凹み Shape | Swift `Shape`（CGPath） | `PathGeometry`（同じ制御点） |
| メトリクス | GeneratedMetrics.swift | GeneratedMetrics.cs（同一 tokens.json 由来） |
| Mic / System audio | AVAudioEngine / ScreenCaptureKit | WASAPI capture / loopback |
| Global shortcut | CGEventTap | RegisterHotKey / LL keyboard hook |

Visual Regression は geometry（位置・寸法・形）を両 OS 共通で、font/blur/shadow は OS 別 reference で比較する。
