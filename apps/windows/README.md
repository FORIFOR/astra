# Astra for Windows（WinUI 3 + C#）

macOS(`apps/astra-macos`) と**同じ Design Spec**（`shared/design/tokens.json`）から
`GeneratedMetrics.cs` を生成し、WinUI 3 でネイティブに描く。ロジックは**共通 Rust コア `astra-core` を
安定 C ABI + P/Invoke で共有**（macOS は UniFFI、Windows は C ABI。同じ core・二重実装なし）。

## 状態（正直に）
- **共有ロジック層は実装＋実測済み**（この macOS ホストでも検証できる部分）:
  - C# CoreBridge（`Astra/CoreBridge/AstraCore.cs`）: version / 録音 session / connector(PKCE・authorize URL・callback 解析) /
    gateway API / mark_uploaded を P/Invoke。**`scripts/verify-csharp-bridge.sh` で実 core に繋いで実測 PASS**。
  - session/data 層（`Astra/AppLogic/AstraSession.cs`）: サインイン / Apps / Library / Agent 往復を**実 gateway で実測 PASS**。
  - 凹み Bezier ジオメトリ: **共有 golden fixture と一致を実測**（macOS Swift Shape と同一）。
  - C ABI 三者一致 contract（Rust ↔ header ↔ C#）を CI で担保。
- **未検証（Windows 実機/CI のみ）**: WinUI の UI レイヤ（`*.xaml` / `*.Window`）の実ビルド・描画。
  Windows App SDK が要るため macOS ではビルドできない。`.github/workflows/windows.yml`（windows-latest）で検証する。

## ビルド手順
共有ロジックの検証（どのホストでも）:
```
pnpm check:cabi-csharp        # Rust/header/C# の三者一致
pnpm verify:csharp-bridge     # C# → 実 core（P/Invoke）+ 実 gateway 往復 + geometry 一致
```
WinUI アプリ本体（Windows のみ）:
```
cargo build --release -p astra-core                # astra_core.dll を作る
copy core\astra-core\target\release\astra_core.dll apps\windows\Astra\astra_core.dll
dotnet build apps/windows/Astra.sln -c Release -p:Platform=x64
```
（`bridge-check` は検証専用の別プロジェクトで、`Astra.sln` には含めない。）

## 対応表（macOS ↔ Windows）
| 役割 | macOS | Windows |
| --- | --- | --- |
| 浮遊窓 | NSPanel | AppWindow + OverlappedPresenter（IsAlwaysOnTop / SetBorderAndTitleBar(false,false)） |
| すりガラス | NSVisualEffectView | Window.SystemBackdrop（Mica / DesktopAcrylic） |
| 凹み Shape | Swift `Shape`（CGPath） | `PathGeometry`（同じ制御点・共有 fixture と一致） |
| メトリクス | GeneratedMetrics.swift | GeneratedMetrics.cs（同一 tokens.json 由来） |
| 共有 core | UniFFI(Swift) | C ABI(C#/P-Invoke) — **同じ astra-core** |
| session/data | MainData(Swift) | AstraSession(C#) — 両方 core 経由で実 gateway |
| Mic / System audio | AVAudioEngine / ScreenCaptureKit | WASAPI capture / loopback（UI 層で実装） |
| Global shortcut | Carbon RegisterEventHotKey | RegisterHotKey（UI 層で実装） |

Visual Regression は geometry（位置・寸法・形）を両 OS 共通の golden で、font/blur/shadow は OS 別 reference で比較する。
