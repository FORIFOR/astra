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

## 追記: context/RAG スライス + C# の実態（Phase 1.6）
- core に `rank_context(ContextQuery, [ContextCandidate]) -> [ContextResult]` を追加。語彙一致 + 新しさ
  （12h 半減）+ プロジェクト一致 + 出典重みの**決定的**合成。両 OS・Tauri が同じ順序を得る単一実装。
  Swift round-trip で `oauth/審査` の候補が正しく先頭に来ることを検証済み。core 13 tests。
- **C# バインディングの実態（捏造しない）**: uniffi 0.29 本体の言語は kotlin/swift/python/ruby のみで
  **C# は同梱されていない**（実測: `--language csharp` は invalid value）。Windows 側は外部ツール
  `uniffi-bindgen-cs`（`cargo install`）で `.cs` を生成する設計にした（`.github/workflows/windows.yml`）。
  この macOS ホストでは未検証。C ABI + P/Invoke の手書き shim に切り替える選択肢も残す。

## 追記: Windows Native の実 solution + C ABI ブリッジ（Phase 1.7）
- **C ABI**: `core/astra-core/src/capi.rs` + 手書きヘッダ `core/astra-core/include/astra_core.h`。
  version / format_elapsed / session(start/push/recorded_ms/finish/free)。uniffi(Swift) と併存。
- **C ABI をこのホストで実証**: `pnpm verify:c-abi` が clang で C→core→ディスクを叩き、断片(160000B)・5000ms を assert。
  **Windows の P/Invoke が使う境界そのものを macOS 上で検証**（WinUI build とは別）。
- **WinUI 3 solution 完成（build 未検証）**: `apps/windows/Astra.sln` + `Astra/Astra.csproj`（WindowsAppSDK）。
  - `App`（通常 Voice HUD）/ `VoiceHudWindow`（borderless・always-on-top・上部中央）/
    `RecordingWorkspaceWindow`（1 枚・DesktopAcrylic・**macOS と同じ凹み Bezier** RecordingWorkspaceGeometry・Task Dock・Hero）/
    `MainWindow`（NavigationView + Mica、4 セクション）。
  - `CoreBridge/AstraCore.cs`: C ABI を P/Invoke（`RecordingSession` は macOS RecordingRuntime と同じ core を叩く）。
  - 寸法は `GeneratedMetrics.cs`（tokens 由来）。
- **CI**: `.github/workflows/windows.yml` が windows-latest で cargo build → dll 配置 → `dotnet build Astra.sln`。
  **この macOS ホストでは dotnet/WinUI をビルドできない（未検証）。Windows PASS は主張しない。**

## 追記: macOS Settings/Permissions + .app パッケージング（Phase 1.8）
- **Settings/Permissions**（SwiftUI）: ショートカット一覧と、マイク/画面収録/アクセシビリティの
  **実 OS 許可状態**（AVCaptureDevice / CGPreflightScreenCaptureAccess / AXIsProcessTrusted）を表示し、
  要求導線を出す。`--demo settings` で実機描画確認。
- **.app パッケージング**: `pnpm build:macos-app`（`scripts/build-macos-app.sh`）で
  `Astra.app`（`com.astra.mac`、`LSUIElement`、NSMicrophone/AppleEvents/Calendars UsageDescription、ad-hoc 署名）を生成。
  `open Astra.app` で起動確認済み。**これで live 許可のダイアログを出せる形になる。**
- **正直な線引き**: ライブの mic/画面/グローバル操作は**ユーザーが TCC ダイアログで許可したときだけ**動く。
  許可付与は自動化できないため、live 取り込みの実 E2E は user-gated（headless では未検証）。
  正式配布は Developer ID 署名 + notarize が別途必要（ad-hoc は開発用）。

## 追記: gateway API を core 経由で（Done#8 の実質前進, Phase 1.9）
- core に `api` モジュール（`ureq`）: `api_dev_sign_in` / `api_me` / `api_reachable`。
  **Tauri の TS client と同じ gateway** を native アプリも同じ core から叩く（二重実装しない）。
- **実バックエンド往復を検証**: `pnpm verify:api-roundtrip`（gateway 未起動なら skip）で
  (1) core の Rust 結合テスト、(2) **Swift → core → gateway → DB**（dev サインイン→/v1/me、新規テナント作成、role=owner）。
  実測 PASS。これで **native の認証経路は Tauri を介さず実バックエンドに繋がる**。
- 残る #8: STT streaming / Agent(Temporal) / RAG 取得 / connector / meeting 送信 の native 経路化はまだ。
  現状 Tauri は無傷（機能パリティ未達のため retire しない）。

## 追記: 会議 control-plane も core 経由（Phase 1.10）
- core api に `api_create_meeting` / `api_finish_meeting`。録音ライフサイクルが**実 gateway に会議を作り**、
  停止で **finalize task を投げる**（成果物生成へ）。`RecordingRuntime.configureBackend(base, token)` でサインイン時に有効化。
- 検証: `--selftest api` が **Swift → core → gateway** でサインイン→/v1/me→会議作成→終了（finalize task id 取得）を実測 PASS。
  会議の control-plane（作成・終了）は Tauri を介さず実バックエンドで動く。**録音音声の WS 送信の native 経路化は残**。

## 追記: 会議の完全経路が core 経由（Phase 1.11）
- core api に `api_upload_meeting_audio`（gateway `/audio` WS へ断片を送る）。
- **Swift → core → gateway の完全 E2E**（`--selftest api`）: サインイン → /v1/me → 会議作成 →
  RecordingSession で実録音 → **音声 WS 送信(192000B)** → 終了(finalize task)。実測 PASS。
- macOS `RecordingRuntime.end` は停止時に「送信 → finalize」を実行。**会議の全経路が Tauri を介さず実バックエンドで動く。**
- 残る #8: STT streaming の native購読 / Agent(Temporal) / RAG 取得 / connector OAuth。Tauri は無傷（他機能のパリティ未達）。

## 追記: 会話/Agent + Apps も core 経由（Phase 1.12）
- core api: `api_start_conversation` / `api_send_turn`（Agent 依頼 → task_id / notice）/ `api_plugin_catalog`（Apps）。
- **Swift → core → gateway の統合 E2E**（`--selftest api`）が サインイン → /v1/me → 会議作成 → 録音 → WS送信 →
  終了 → **会話/Agent turn** → **Apps catalog(12件)** まで実測 PASS。dev の会話エンジンは仕事を起こさず notice を返す（経路は正常）。
- 最終製品経路のうち **auth / meeting全経路 / conversation・Agent入口 / Apps一覧** が Tauri を介さず実バックエンドで動く。
- **#8 の残（正直に）**: STT streaming の native 購読、Agent の実行結果(task)ストリーム購読、RAG 取得 API、connector OAuth。
  これらは外部サービス/OAuth を伴い、Tauri 側に残置（パリティ未達のため retire しない）。

## 追記: Agent round-trip も core 経由（Phase 1.13）
- core api: `api_create_task`（Idempotency-Key 付与）/ `api_task_status` / `api_wait_task`。
- **Agent 実往復を検証**: echo タスク作成 → Temporal worker 実行 → **COMPLETED + 成果物 id**。
  Rust 結合テストと Swift `--selftest api` の両方で実測 PASS（agent=COMPLETED）。
- **最終製品経路で Tauri を介さず動くもの（実測）**: auth / 会議全経路(作成〜録音〜送信〜終了) /
  conversation・Agent入口 / **Agent タスク実行(完了・成果物)** / Apps一覧。
- **#8 残（正直に）**: STT streaming の native 購読（音声 partial/final の受信）、RAG 取得 API、connector OAuth。
  これらは外部 STT/OAuth を伴い Tauri 側に残置。Done#8「完全 retire」は未達（機能パリティ未達のため Tauri 無傷で残す）。

## 追記: 成果物内容 + Library、Main Window 実データ購読（Phase 1.14）
- core api: `api_artifact_content`（成果物本文）/ `api_library`（Library 一覧）。
- **完全ループを検証**: Agent(echo) → 成果物 → **本文取得(55B)** → Library(3件)。Rust 結合 + Swift `--selftest api` 両方 PASS。
- macOS Main Window の Apps/Agents/Library ペインは **core 経由で実 gateway から**取得（dev サインイン、`MainData.load`）。
- 最終製品経路で Tauri を介さず実測できたもの: auth / 会議全経路 / conversation・Agent入口 /
  Agent実行(完了・成果物・本文) / Apps一覧 / Library。
- **#8 の真の残**: STT streaming の native 購読（音声 partial/final）、connector OAuth（外部プロバイダ・ユーザー許可）。
  外部サービスと OAuth を伴い、この環境で完了・検証不可。Done#8「完全 retire」は未達。

## 追記: transcript 取得経路（Phase 1.15）
- core api: `api_meeting_segment_count`（GET /v1/meetings/:id/segments）。native が文字起こしを引く口。
  dev の STT は未接続のことがあるため件数 0 も許容（**経路が通ることを検証**）。
- **#8 の最終的な残（正直に）**: STT streaming の**実データ**（音声 partial/final の native 購読）は
  外部 STT プロバイダ（Google STT 等）の鍵が要り、この環境では未接続。connector OAuth も外部プロバイダ + ユーザー許可。
  よって Done#8「旧 Tauri を最終製品経路から完全に外す」は**未達**（会議/Agent/Apps/Library の経路は core 化済み、
  STT実データと connector OAuth が残るため Tauri を無傷で残す）。

## 追記: 文字起こしドメインを core へ（Phase 1.16）
- `astra-core::transcript` を新設: `LiveWindow`（窓/ホップのセグメント化と検証）・`TranscriptEvent`
  （途中経過/確定、TS 契約 `{type:"partial"|"final"}` と同一表現）・`merge_overlap`（重なりの畳み込み）。
  これらは録音エンジンにも OS にも依存しない**純ドメイン**。sherpa-onnx の C 束縛（ffi/library/model と
  `LocalRecognizer` エンジン本体）は**プラットフォーム統合**として `apps/desktop/src-tauri/src/stt` に残す。
- Tauri の `stt/recognizer.rs` はローカル定義を削除し `pub use astra_core::{LiveWindow, TranscriptEvent, merge_overlap}`
  で再エクスポート。`voice.rs`/`lib.rs` の import 経路（`crate::stt::recognizer::…`）は**無改修**（最小差分）。
- serde 表現は完全維持（enum の `rename_all` はタグ値のみに効き、フィールドは snake_case のまま＝元と同一挙動）。
- **実測**: core 19 tests PASS（transcript 5 件を含む）/ Tauri Rust 73 tests PASS・0 失敗（`stt` 13 + voice 等、
  回帰なし。sherpa 実モデルが要る `real` 3 件は ignored＝**live STT は未検証境界のまま**）/ 
  swift-bindings・design-tokens ともに `--check` current（FFI 表面は不変、TranscriptEvent は uniffi 非公開）/ conventions PASS。
- **意味**: 文字起こしの**ドメインロジック**が Tauri から core へ移り、共有 core が担う範囲が広がった（①/⑧ の前進）。
  ただし Done#8「完全 retire」は依然**未達**: 残るのは (a) 実 STT エンジンの native 実行と live 音声の
  partial/final（外部 STT 鍵が必要）、(b) connector OAuth（外部プロバイダ + ユーザー許可）。純ドメインは core 化したが、
  エンジン統合と外部サービス経路が残るため Tauri を無傷で残す。

## 追記: グローバル音声ショートカット（Phase 1.17, macOS native）
- `Windowing/GlobalShortcut.swift` を新設。**Carbon `RegisterEventHotKey`** で ⌥Space を OS へ登録し、
  押下で `WindowCoordinator.toggleRecording()`（通常 HUD ↔ Recording Workspace の出し入れ）を呼ぶ。
  CGEventTap と違い**単一ホットキーの登録は Accessibility(TCC) を要さない**ので、この環境で登録まで実検証できる。
- 配線: `WindowCoordinator` に `isRecording` と `toggleRecording()` を追加、`AstraAppDelegate` が起動時に登録。
- 検証: `AstraMac --selftest shortcut` を追加し `scripts/verify-macos-recording.sh` に組み込み。
  **実測 PASS**: `SELFTEST_OK shortcut: registered=true combo=⌥Space`（headless、TCC/GUI 不要、exit 0）。
  既存 selftest（record/lifecycle）と swift unit 3 件も回帰なし。
- **live 境界（正直に）**: 押下の**受信**（別アプリ前面での ⌥Space で実際に録音が始まる）は、署名済み .app 上で
  ユーザーが実際に押して確かめる live 動作。登録の成立は検証済みだが、押下受信の live E2E は Done#3(live) の
  TCC/署名ゲートに含まれ、この環境では未検証。
- Done#2「Global voice shortcut」の**実装完了**（mock ではなく実 Carbon 登録）。§3 の残る native 実機能
  （System Audio=ScreenCaptureKit / Screen Context / Calendar=EventKit）は未実装で継続対象。

## 追記: システム音声取り込み（Phase 1.18, macOS native / ScreenCaptureKit）
- `Audio/SystemAudioCapture.swift` を新設。**ScreenCaptureKit** の `SCStream` 音声出力を
  MicCapture と同じ契約（16 kHz mono f32 の `onFrame`）へ変換する。会議の「相手側の声」を録るための実機能。
  `excludesCurrentProcessAudio=true` で Astra 自身の音は除外。CMSampleBuffer → AVAudioConverter で 16k mono 化。
- `RecordingRuntime.begin(..., captureSystemAudio:)` に統合。mic と同じ session へ push（両方を混ぜて録る）。
  許可が無ければ system audio 抜きで続行（mic だけで成立）。
- 検証: `--selftest sysaudio` を追加し verify-macos-recording.sh に組み込み。
  **実測 PASS**（TCC 不要の構成検証）: `SELFTEST_OK sysaudio: capturesAudio=true sampleRate=48000 channels=2 excludesSelf=true`。
- **live 境界（正直に）**: 実フレームの取り込み（`getShareableContent`→`startCapture`）は**画面収録許可(TCC)**が要り、
  署名済み .app 上でユーザーが許可して確かめる live 動作。構成の組み立ては検証済みだが、フレーム取り込みの
  live E2E は Done#3(live) に含まれ、この環境では未検証。CMSampleBuffer 変換経路は MicCapture と同じ実績ある算法。
- §3 の native 実機能の進捗: Mic(済) / **System Audio(実装・構成検証済)** / Global shortcut(済)。
  残り: Screen Context(ScreenCaptureKit 映像) / Calendar・Reminders(EventKit) / live STT streaming。

## 追記: カレンダー取り込み（Phase 1.19, macOS native / EventKit）
- `Audio/CalendarAccess.swift` を新設。**EventKit** で認可状態の読み取り・許可要求・直近予定の取得。
  会議の文脈（今どの予定か）を RAG/context に渡すための実機能。`status()` はプロンプトを出さず
  常に有効な列挙を返す。許可が無ければ `upcoming()` は空（**推測で埋めない**）。
- `Settings/Permissions` に `calendar` 状態、`SettingsView` に「カレンダー」許可行を追加（実 UI 面で消費）。
- `scripts/build-macos-app.sh` の Info.plist に **`NSCalendarsFullAccessUsageDescription`** を追加
  （macOS 14 の `requestFullAccessToEvents` はこのキーが無いとクラッシュする）。
- 検証: `--selftest calendar` を追加し verify-macos-recording.sh に組み込み。
  **実測 PASS**（TCC 不要の状態読み取り）: `SELFTEST_OK calendar: status=未確認 upcoming=0`。
  加えて **release .app をパッケージし ad-hoc 署名**、その .app バイナリで sysaudio/shortcut selftest も PASS。
- **live 境界（正直に）**: 実予定の取得はカレンダー許可(TCC)が要り、署名済み .app 上でユーザーが許可して
  確かめる live 動作。状態読み取りと .app パッケージングは検証済みだが、実データ取得は Done#3(live) に含まれ未検証。

### §3 native 実機能の到達点
- 実装・headless 検証済み: Mic / **System Audio** / **Global shortcut** / **Calendar(状態)** / meeting recording & recovery / RAG(core) / Agent(core)。
- **live(TCC/署名)ゲートで未検証**: 実 mic 波形・実 system audio フレーム・実カレンダー予定・グローバル押下受信。
- **未実装で継続対象**: Screen Context(ScreenCaptureKit 映像フレーム)、live STT streaming(外部 STT 鍵)、connector OAuth。

## 追記: 画面文脈の取り込み（Phase 1.20, macOS native / ScreenCaptureKit 映像）
- `Audio/ScreenContextCapture.swift` を新設。**ScreenCaptureKit** の `SCScreenshotManager.captureImage` で
  前面ディスプレイの静止フレーム（BGRA CGImage）を 1 枚取る。Context Lens / RAG に「今見ているもの」を渡すため。
- 検証: `--selftest screen`（構成の検証、TCC 不要）を追加し verify に組み込み。
  **実測 PASS**: `SELFTEST_OK screen: width=1280 height=800 pixelFormat=BGRA audio=false`。
- **live 境界**: 実フレーム取得は画面収録許可(TCC)が要り Done#3(live) に含まれ未検証。
- これで §3 の capture 三点（Mic / System Audio / Screen Context）が実装＋構成検証済みに揃った。
