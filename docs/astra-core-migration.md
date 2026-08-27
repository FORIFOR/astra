# Astra Core 移行（Phase 1 完了）

## 何をしたか
OS/UI 非依存のロジックを共通 Rust crate **`astra-core`** に切り出し、macOS Swift アプリから
**UniFFI 経由で実際に呼べる** vertical slice を通した。Tauri 側も同じ core を使い、二重実装を消した。

```
shared/design/tokens.json ─┐
                           │ gen-design-tokens (Swift/C# Metrics)
                    astra-core (Rust, OS/UI 非依存)
                           │  UniFFI
        ┌──────────────────┼───────────────────┐
   macOS SwiftUI      apps/desktop (Tauri)   Windows WinUI(未ビルド)
   AstraCoreBridge     meeting.rs が core を     GeneratedMetrics.cs
   → AstraCore         plain Rust として利用      + 設計メモのみ
```

## vertical slice（実機能）
「会議録音の状態・断片モデル・表示派生」を選定（goal 優先順の meeting/state/model）。core の中身:
- `AstraMode`（Idle/Listening/Thinking/Recording/RecordingPaused/Processing）— 両 OS 共通の状態語彙
- `to_wire(Vec<f32>) -> Vec<u8>`（f32 mono → 16-bit LE。AVAudioEngine / WASAPI 双方の PCM を同形に）
- `format_elapsed(ms) -> String`、`recording_snapshot(RecordingInput) -> RecordingSnapshot`
  （経過ラベル・録音中/一時停止中・オフライン表示の派生。UI 各言語で書き直さない）
- `Journal` / `Manifest` / `scan_recoverable`（断片台帳・クラッシュ回復）— plain Rust（fs のみ）

FFI 境界には安定した Record/Enum だけを出し、Rust 内部型（`Journal` など）は UniFFI に晒さない。

## 生成・検証（すべて再現可能・手編集禁止）
- `pnpm gen:swift-bindings`（`--check` で CI 鮮度検査）: `cargo build` → `uniffi-bindgen` →
  `apps/astra-macos/Sources/AstraCore/astra_core.swift` と `Sources/AstraCoreFFI/include/*`
- `pnpm verify:swift-roundtrip`: Swift → UniFFI → Rust → Swift の実 round-trip（version/snapshot/wire を assert）
- `pnpm gen:design-tokens --check`: 既存の Design Token 生成は維持

## Tauri を壊していないこと（§8 脱重複）
`apps/desktop/src-tauri/src/meeting.rs` の純粋定義（JournalState/Manifest/Journal/scan_recoverable/
to_wire/LinkState/定数）を削除し `use astra_core::…` に置換。frontend への wire 表現（LinkState snake_case、
RecoverableMeeting camelCase）は core 側 serde で維持。Tauri crate の Rust テスト 77 passed、desktop JS 352 passed。

## Windows 向け境界（再利用の明文化）
- **共通**: astra-core の Record/Enum/関数（`recording_snapshot` / `to_wire` / `format_elapsed` /
  `scan_recoverable` / `AstraMode`）。C# へは UniFFI の C# backend か C ABI で同じ core を呼ぶ。
  寸法は `shared/design/tokens.json` → `GeneratedMetrics.cs`。
- **Windows 側で実装（core に入れない）**: WASAPI capture/loopback、Windows.Graphics.Capture、
  RegisterHotKey、AppWindow/OverlappedPresenter、DesktopAcrylic。
- **未検証**: この開発機は macOS のため WinUI/C# はビルドしていない（`apps/windows` は雛形+生成物のみ）。

## 残課題 / 次 Phase（Phase 2 候補）
1. Journal の実書き込みも core 経由に寄せる（今は src-tauri が core の `Journal` を使用、macOS Swift 側の
   録音実書き込みは未接続）。
2. astra-core の C# binding 生成（`uniffi-bindgen` C# もしくは C ABI）を Windows 実機で検証。
3. macOS Swift の録音実データ接続（AVAudioEngine → to_wire → gateway）を core 経由に。
4. RAG / agent planning の pure model を次の slice として core へ。
5. SwiftPM の Rust ライブラリ参照は今 `-L ../../core/astra-core/target/debug` の相対 unsafeFlags。
   配布時は xcframework 化を検討（今回は開発ビルド用）。

## 追記: 実録音ランタイム（Phase 1.5）
- core に `RecordingSession`（UniFFI object）を追加。マイクの f32 サンプルを受け取り、16 kHz へ寄せて
  **実断片ファイル**（`meetings/<id>/mic/NNNNNN.pcm`）へ書き、manifest を進め、回復候補にする。送信は OS 側。
- macOS: `MicCapture`(AVAudioEngine) → `RecordingRuntime` → `RecordingSession`。
  **shared core が実運用経路で使われる**（Done#1 の実証）。
- 検証: `pnpm verify:macos-recording`（`AstraMac --selftest record`）で Swift→core→ディスクを headless E2E。
  合成音源で断片(160000B=5s×16k×2)・経過(00:05)・回復候補を assert。`swift test` に XCTest 3 件。

## 未検証の境界（正直な線引き）
- **ライブ mic/システム音声/画面/グローバル shortcut/Calendar** は署名済み **.app バンドル + TCC 許可**が要る。
  現在は SwiftPM 実行アプリのため、これらの**実許可・ライブ取り込みは headless で未検証**（`MicCapture` は実装済みだが
  裸実行では許可プロンプトが出ない）。実検証は Xcode .app 化 + 署名 + 手動許可が前提。
- **Windows (WinUI3/C#)**: この macOS ホストでは**ビルド不可**。`apps/windows` は雛形+生成 Metrics のみ。
  `.github/workflows/windows.yml` に core+C# binding のビルド枠を用意（.sln は Phase 4 で追加）。**Windows PASS は主張しない。**
