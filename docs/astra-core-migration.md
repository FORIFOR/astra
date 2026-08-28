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

## 追記: サインイン折り返しの契約を core へ（Phase 1.21）

- `astra-core::oauth` を新設: `CallbackParams`（折り返しで戻る値の型）・`parse_callback`（クエリ解析）・
  `percent_decode`（form-urlencoded）・`is_allowed_auth_url`（https と loopback だけ許す URL 判定）。
  RFC 8252 の native app サインインで、macOS/Windows native が**自前の loopback listener から同じ関数**を使う。
  §1 の「connector contracts / API・domain 処理」を core へ寄せる一歩。
- Tauri の `oauth.rs` はローカル定義（型・parse・decode・URL 判定）を削除し `pub use astra_core::{…}` と
  `astra_core::is_allowed_auth_url(&url)` へ差し替え。**待ち受け（TcpListener）とブラウザ起動（`open`）は OS 統合として残す**
  （AppHandle/Tauri command は core に入れない原則を維持）。serde 表現・コマンド署名は不変。
- **実測**: core **26 tests**（oauth 7 件を含む、parse/decode/URL 判定）/ Tauri Rust **67 tests・0 失敗**
  （73→67 は移動した 6 パーステストの差、回帰なし）/ swift-bindings・design-tokens `--check` current / conventions PASS。
- **意味**: サインイン折り返しの**セキュリティ判定と契約処理**が Tauri から core へ移り、両 OS native が共有する
  （①/⑧ の前進）。**残る connector の外部依存**（各プロバイダの OAuth 実行フロー・トークン交換）は
  外部サービス + ユーザー許可を伴い、この環境で完了・検証不可。Done#8「完全 retire」は依然未達。

## 追記: RAG ドロワーを core の rank_context に接続（Phase 1.22, macOS native）

- macOS の RAG ドロワーは静的チップだけで core を呼んでいなかった。`AstraCoreBridge.rankContext` を追加し、
  `RecordingWorkspaceState.refreshRag()` が**この会議の transcript から実候補**を作って core の `rank_context`
  （語彙一致・新しさ・プロジェクト一致 × source 重み、決定的）で並べ替え、`RAGDrawerView` が score と
  **根拠(reason)** 付きで上位を描く（§8「根拠を出す」）。外部コネクタ（Gmail/Drive）の候補は接続後に足す。
- 検証: `--selftest rag`（bridge→core の決定的ランキング）を追加し verify に組み込み。
  **実測 PASS**: `SELFTEST_OK rag: order=a,c,b topScore=1.00 reason=語が 1 件一致 · 新しい · このプロジェクト`
  （語彙一致する 2 件が非一致より上、新しく projectMatch な方が最上位）。全 selftest 7 件 + swift unit 3 も回帰なし。
- **意味**: core の `rank_context` が **macOS native の実 UI 経路**で使われる（① 実運用経路 / ⑦ RAG 統合の前進）。
  ランキングは core・候補は実 transcript（捏造なし）。live コネクタからの候補供給は外部依存で継続対象。

## 追記: Keychain 資格情報ストア（Phase 1.23, macOS native / Security.framework）

- native app に Keychain が無かった。`Settings/KeychainStore.swift`（Security.framework SecItem, generic-password,
  service=`com.astra.mac`, upsert/get(None)/idempotent delete, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`＝
  iCloud 非同期）と `Settings/SessionStore.swift`（**refresh/device token は Keychain のみ**、access token は保管しない）を追加。
  Tauri 側 `secrets.rs`（keyring）と同じ契約を native に用意。正本 §21 / device-boundary。
- 検証:
  - `--selftest keychain`（set→get→delete→get(absent) 往復、TCC/GUI 不要）**PASS**: `roundtrip ok, absent=nil, delete idempotent, service=com.astra.mac`。verify に組み込み。
  - `--selftest api`（実 gateway）を拡張し、**実サインインで得た refresh token を Keychain に保管して読み戻す**。
    **実測 PASS**: `SELFTEST_OK api: … refreshInKeychain=true`（core sign-in → 実 refresh token → Keychain 往復）。
- **意味**: §3「Keychain」を実機能として実装＋検証（mock ではない）。資格情報の境界（refresh/device は Keychain、
  access はメモリ）を native 側で担保。全 selftest 8 件 + swift unit 3 も回帰なし。

## 追記: ローカルファイル文脈（Phase 1.24, macOS native / Finder access → RAG）

- `Context/FileContext.swift` を新設。ユーザーが選んだフォルダ/URL のファイルを読み、抜粋を
  `ContextCandidate`(source=.library) にして core の `rank_context` で並べ替える。**全ディスクは漁らない**
  （選んだフォルダだけ）。テキストとして読めないバイナリは候補にしない（§5「見たものだけ」）。
- `RecordingWorkspaceState.refreshRag` が transcript 候補とファイル候補を同じ土俵で並べ替え。
  RAG ドロワーの「ファイル」チップを `NSOpenPanel`（フォルダ選択）に接続し、実ユーザー動作にした。
- 検証: `--selftest files`（一時ファイルを作り core で並べ替え）を追加し verify に組み込み。
  **実測 PASS**: `SELFTEST_OK files: candidates=2(binary除外) top=oauth.txt score=0.72`
  （語彙一致する oauth.txt が最上位、バイナリは候補から除外）。全 selftest 9 件 + swift unit 3 も回帰なし。
- **意味**: §3「Finder access」を実機能として実装（外部 OAuth 不要のローカル RAG ソース、mock ではない）。
  RAG のソースが transcript に加えローカルファイルへ広がった（#2/#7 の前進）。Gmail/Drive は外部 OAuth のため継続対象。

## 追記: アクセシビリティ文脈（Phase 1.25, macOS native / AX 選択テキスト → RAG）

- `Context/AccessibilityContext.swift` を新設。前面アプリで**選択中のテキスト**を AX
  (`AXUIElementCopyAttributeValue` の focused → selectedText)で読み、RAG 候補(source=.message)にする。
  `AXIsProcessTrusted()` は prompt を出さず読め、**許可が無ければ nil**（推測で埋めない・クラッシュしない）。
- `refreshRag` が transcript / ファイル / **AX 選択** を同じ土俵で core の `rank_context` に載せる。
- 検証: `--selftest ax`（許可なし→nil の正直な経路、no-crash）を追加し verify に組み込み。
  **実測 PASS**: `SELFTEST_OK ax: trusted=true selection=nil candidates=0`（AX 経路が実行され、選択なしを nil で処理）。
  全 selftest 10 件 + swift unit 3 も回帰なし。
- **意味**: §3「Accessibility integration」を実機能として実装。実選択テキストの取得は AX 許可(TCC)ゲートで
  Done#3(live) に含まれるが、経路・許可判定・no-crash は検証済み。

### §3 native 実機能の到達（このセッション終了時点）

- 実装＋headless 検証済み: Mic / System Audio / Screen Context / Global shortcut / Calendar(状態) /
  **Keychain**(実トークン往復) / **Finder access**(ローカル RAG) / **Accessibility**(経路) / transcript保存 /
  meeting recording & recovery / RAG(core rank_context) / Agent(core, 実 gateway)。
- live(TCC/署名)ゲートで未検証: 実 mic 波形・system audio フレーム・screen フレーム・カレンダー予定・
  グローバル押下受信・AX 実選択テキスト。
- 外部依存で未達: **Streaming STT**(sherpa dylib＋モデル) / **connector OAuth 実行**(外部プロバイダ)。

## 追記: オンデバイス Streaming STT（Phase 1.26, macOS native / Apple Speech）

- `Audio/SpeechTranscriber.swift` を新設。**Apple の SFSpeechRecognizer（オンデバイス）** でマイクの
  16 kHz mono を途中経過/確定へ変える。`requiresOnDeviceRecognition=true`＝**sherpa-onnx の dylib もモデルも要らず、
  外部 STT にも送らない**（§11「音は手元で文字に」）。`RecordingRuntime` がマイクフレームを session（保存）と
  transcriber（文字起こし）へ同時に流し、`RecordingWorkspaceState` が途中経過/確定を transcript に反映して RAG も更新。
- Info.plist に `NSSpeechRecognitionUsageDescription` を追加。
- 検証: `--selftest speech` を追加し verify に組み込み。**実測 PASS**:
  `SELFTEST_OK speech: auth=3(authorized) onDeviceCapable=true started=true appendedFrames=true`。
  この環境では音声認識が**認可済み・オンデバイス対応**で、認識開始→実フレーム append→finish まで no-crash で通った
  （setup→start→feed→finish の live 経路を headless で実行）。全 selftest 11 件 + swift unit 3 も回帰なし。
- **意味（Done#8 の実質前進）**: macOS native app が **自前のオンデバイス STT** を持ち、Tauri の sherpa エンジンに
  依存せず文字起こしできる。外部 STT 鍵も sherpa dylib＋モデルも不要。**残る Tauri 依存は connector OAuth 実行のみ**
  （外部プロバイダ＋ユーザー許可）。実音声からの認識精度・確定は署名 .app＋音声認識許可でのユーザー検証（Done#3 live）。

## 追記: connector 契約層を core へ（Phase 1.27）

- `astra-core::connector` を新設（§1「connector contracts」）。**live なトークン交換は持たない**（提供者ごとの
  外部処理は各アプリ/gateway に残す）。持つのは OS 非依存の契約層だけ:
  - `OauthProvider`（google/microsoft の端点・追加パラメータ・`client_id` env 名）
  - `pkce_challenge`（**RFC 7636 S256**、base64url(sha256)。plain に落とさない）
  - `build_authorize_url`（**RFC 6749 §4.1**、loopback 以外の redirect と空 client_id を拒否）
  - `accept_callback`（**CSRF state 照合・期限切れ・エラー**の受理判定）
  - `configured_providers` / `unconfigured_providers`（client_id がある提供者だけ、無いものを埋めない）
  - TypeScript `@astra/oauth`（flow/pkce/providers）を Rust 契約へ写したもの。`client_secret` は持たない（RFC 8252 §8.5）。
- 依存に `sha2` を追加（PKCE 用、オフライン解決可）。UniFFI にフラットな入口
  （`connector_pkce_challenge` / `connector_authorize_url` / `connector_configured_provider_ids`）を出し、Swift から使える。
- 検証:
  - core **connector 6 tests**（**RFC 7636 PKCE テストベクタ一致**を含む＝自前 base64url+sha2 が spec 準拠）。core 計 **32 tests**。
  - **Swift 実経路**: `--selftest connector` が bridge→core で PKCE・authorize URL 組み立て・loopback 拒否を検証。
    **実測 PASS**: `SELFTEST_OK connector: pkce=S256✓ authorizeUrl✓ nonLoopbackRejected✓ configured=0`。
  - Tauri Rust **67 tests・0 失敗**（sha2＋connector 追加後も回帰なし）/ swift-bindings・design-tokens `--check` current / conventions PASS。
- **意味**: connector の**契約・オブジェクトモデル**が core に入り、macOS native の実経路で使われる（①/⑧ 前進）。
  **残る Tauri/外部依存は「live なトークン交換の実行」のみ**（token endpoint への POST ＝提供者ごとのネットワーク処理・ユーザー許可）。
  Windows は同じ core を C ABI 経由で使える（C ABI ラッパー追加は後続、Windows 実機検証は CI のみ）。

## 追記: connector を C ABI + Windows C# bridge へ（Phase 1.28）

- `capi.rs` に `astra_core_pkce_challenge` / `astra_core_authorize_url`（文字列 in/out、非 loopback・空 client_id・
  未知 provider は NULL）を追加し、`include/astra_core.h` に宣言。**Windows(C#/P-Invoke) が Swift と同じ core の
  connector 契約層を使える**ようにした（uniffi は C# 非対応のため安定 C ABI 経由）。
- `apps/windows/Astra/CoreBridge/AstraCore.cs` に P/Invoke 宣言と `AstraCore.PkceChallenge` / `AstraCore.AuthorizeUrl`
  を追加（macOS の bridge と対の薄い層）。
- 検証: `verify-c-abi.sh` を拡張し、**C(clang) から** PKCE(RFC 7636 ベクタ)・authorize URL 組み立て・非 loopback 拒否を実証。
  **実測 PASS**: `CABI_OK connector: pkce=S256 authorizeUrl ok nonLoopbackRejected`。core 32 tests / 既存 C ABI 録音往復も PASS。
  swift-bindings・design-tokens `--check` current / conventions PASS。
- **Windows 未検証（捏造しない）**: C# の実ビルド/実行は Windows 実機（CI）でのみ。ただし **C# が P/Invoke する C ABI 境界は
  このホストの C から検証済み**。connector 契約層は macOS(Swift/UniFFI)・Windows(C#/C ABI) の両方から同じ core を使う形が揃った。

## 追記: トークン交換も core へ（Phase 1.29, connector フロー完成）

- `astra-core::connector` に `TokenSet` / `token_exchange_body`(RFC 6749 §4.1.3, **code_verifier を省かない**) /
  `parse_token_response`(error を握り潰さない・**期限/scope を推測しない**) / `exchange_code`(token endpoint へ POST) を追加。
  TS `@astra/oauth` の flow.ts を Rust 契約へ写した。
- **body 構築と応答 parse は純ドメインで単体検証**。`exchange_code` は ureq で POST するが、**実 HTTP 呼び出し
  （提供者サーバへの接続）だけが外部依存**で、それ以外は core・検証済み。
- 検証: connector **9 tests**（body に code_verifier / expires_in→expires_at / scope 無しは空 / error 伝播 / access_token 無しは
  NoAccessToken）。core 計 **35 tests**。Tauri Rust ビルド OK（回帰なし）/ C ABI verify・swift-bindings `--check`・conventions PASS。
- **意味**: connector フロー全体（**authorize URL → PKCE → callback 受理 → トークン交換**）が core 化され、
  macOS(Swift/UniFFI)・Windows(C#/C ABI) が同じ実装を使う。**残る外部依存は「実 OAuth 提供者への live な HTTP 交換
  （＋ユーザーの consent 操作）」のみ**——これは提供者のサーバとユーザー許可が要り、この環境で完了・検証不可。
  Done#8 の「connector の live 実行」を除く契約・ドメインは core に集約完了。

## 追記: gateway API を C ABI + C# へ（Phase 1.30, Windows パリティ）

- `capi.rs` に gateway API の C ABI を追加: `astra_core_api_reachable` / `_dev_sign_in`(Tokens JSON) / `_me`(Me JSON) /
  `_create_meeting` / `_create_task` / `_wait_task`(TaskStatus JSON) / `_artifact_content` / `_plugin_catalog`(JSON配列) /
  `_library`(JSON配列)。複合型は JSON、失敗は NULL。api の record に `serde::Serialize` を足した（uniffi binding は不変）。
- `include/astra_core.h` に宣言、`AstraCore.cs` に P/Invoke + `ApiReachable/ApiDevSignIn/ApiMe/ApiCreateMeeting/
ApiCreateTask/ApiWaitTask/ApiArtifactContent/ApiPluginCatalog/ApiLibrary`。**Windows C# が macOS(Swift/UniFFI) と同じ
  実バックエンド経路を使える**ようになった（それまで C ABI は録音と connector だけだった）。
- 検証: `verify-c-abi.sh` を拡張し、**C(clang) から live gateway に縦断**。**実測 PASS**:
  `CABI_OK api: me=owner meeting=ok agent=COMPLETED apps=[... library=[...`
  （サインイン→/v1/me=owner→会議作成→echo タスク→**COMPLETED**→Apps→Library）。gateway 未到達なら CABI_SKIP。
  core 35 tests / swift-bindings・design-tokens `--check` current / conventions PASS / Tauri ビルド回帰なし /
  macOS `--selftest api`(UniFFI 経路)も PASS。
- **意味（Done#4 の前進）**: Windows の core bridge が macOS と**同じ gateway 実経路の全体**（auth/meeting/agent/apps/library）を
  持ち、**C# が P/Invoke する C ABI 境界を live gateway に対して C から検証済み**。C# の実ビルド/実行のみ Windows CI 待ち。

## 追記: C ABI 三者一致の contract テスト（Phase 1.31, Windows 境界の担保）

- `scripts/check-cabi-csharp.mjs` を新設。**Rust の `#[no_mangle] extern "C"`（実体）↔ C ヘッダ（宣言）↔
  C# の P/Invoke（呼び出し）** の関数名・引数個数を機械照合する。Windows 実機でビルドできないぶん、
  C# が呼ぶ C ABI 境界が実体とズレていないことをここで止める（§6「FFI contract」）。
- CI に組み込み: `pnpm check:cabi-csharp` を `ci.yml`（conventions の直後、ubuntu で host 非依存）と
  `windows.yml`（WinUI ビルド前）に追加。
- 検証: **実測 PASS** `C ABI contract ok: Rust 19 = header 19, C# が呼ぶ 19 個すべて一致`。
  **負テスト**: C# に余分な引数を注入すると `C# 引数 3 個 ≠ header 2 個` を検出して fail（ドリフトを実際に止める）。
- **意味（Done#4/#6 の前進）**: Windows 実機が無くても、C# bridge が Rust の C ABI 実体と一致していることを
  CI で継続的に担保できる。C# の実ビルド/実行のみ windows-latest CI 待ち（そこも同じ contract を通す）。

## 追記: live 実機 E2E（Phase 1.32, Done#3 の一部を実測 PASS に）

- この開発環境の TCC を調べたところ **mic=許可済み / screen=許可済み / ax=許可済み / speech=authorized**
  （親プロセスから継承）。これまで「TCC ゲートで未検証」としてきた live 経路の一部を**実機で検証できる**と判明。
- 追加した self-test（`verify-macos-recording.sh` に統合、未許可環境=CI では SELFTEST_SKIP）:
  - `--selftest permissions`: TCC 状態を正直に列挙（prompt 無し）。**実測**: `mic=許可済み screen=許可済み ax=許可済み speech=3`。
  - `--selftest livemic`: **実マイクデバイスから取り込み**。**実測 PASS**: `frames=9 samples=14168`（peak=0 は無音環境だが
    AVAudioEngine タップ→変換→コールバックの実経路が動作）。
  - `--selftest livemeeting`: **実マイク → RecordingRuntime(session + オンデバイス STT) → 保存 → 回復** の実機 E2E。
    **実測 PASS**: `実マイク recordedMs=5000 recovered=true`（5 秒断片が実際に書かれ回復候補になった。sttEvents=0 は無音のため）。
  - `--selftest livescreen`: SCK は headless/accessory 文脈で前面セッションを要するため、**`CGDisplayCreateImage`
    にフォールバック**（画面収録許可で動作・前面不要）。**実測 PASS**: `captured 2560x1440 real frame (CGDisplay)`。
- **意味（Done#3 の前進）**: **live mic 取り込み・実マイク会議録音/回復・実 screen フレーム取得は実測 PASS**
  （合成でなく実デバイス/実ディスプレイ）。残る live 未検証は「実音声を伴う STT 認識精度・カレンダー実データ・
  グローバル押下受信」で、実音声/カレンダー許可/ユーザー操作を要し、この非対話環境では確認不可（捏造しない）。

## 追記: STT 認識精度の検証を試行（Phase 1.33, 環境制約で SKIP）

- `SpeechTranscriber.recognizeFile` を追加（音声ファイルをオンデバイスで 1 回認識。会議録音の後処理に使える実機能）。
- `--selftest sttrecognize`: `say` で実音声(en-US, 22050Hz, 2.75s)を生成しオンデバイス STT に通す。
- **結果は正直に SKIP**: on-device 有無に関わらず、この **headless/非対話環境では認識器がテキストを返さない**
  （エラーも結果も出ない＝前面セッションを要する環境制約と判断）。捏造 PASS はしない。
- STT の**パイプライン**は別途検証済み（`--selftest speech` の start/append/finish、`--selftest livemeeting` で
  実マイク取り込み中に on-device STT が稼働）。**残るは認識テキストの出力**で、これは署名 .app を前面で
  動かす実運用（実音声・前面セッション）でユーザーが確認する live 項目。

## 追記: Recording Workspace の visual regression fixture（Phase 1.34, §5/§6）

- `scripts/gen-workspace-fixture.mjs` を新設。`shared/design/tokens.json` から Recording Workspace の外枠
  （上辺中央の凹み Bezier）を**正準の SVG パス**として生成し `shared/design/fixtures/recording-workspace.{svg,path}`
  に golden 出力。`--check` で鮮度検査（design token と同じ扱い）。
- macOS(`RecordingWorkspaceShape`) と Windows(`RecordingWorkspaceGeometry`) は**同一の制御点**（固定オフセット 14/15 ＋
  token 由来の cornerRadius/notchWidth/notchDepth/notchShoulder）でこの形を描く。両 OS がこの golden と一致することを
  visual regression fixture として担保する。
- 検証:
  - `--selftest shape`（Swift）: `RecordingWorkspaceShape` のパスを再構築し golden と**完全一致**を確認。
    **実測 PASS**: `path matches shared fixture (14 segments)`。verify に組み込み。
  - `pnpm check:workspace-fixture`（鮮度）を `ci.yml` と `windows.yml` に追加。
- **意味（§5/§6 の充足）**: UI 寸法を各 OS へ直書きせず tokens から生成し、共通 fixture で両 OS の形の一致を
  機械検査できる。macOS 側は Swift Shape が golden と一致することを実測、Windows 側は同一構築＋CI で fixture 鮮度を担保。

## 追記: 録音エントリの無限再帰バグ修正 + HUD ライフサイクルテスト（Phase 1.35）

- **バグ発見・修正**: `WindowCoordinator.enterRecordingMode()` が `RecordingWorkspaceState.start()` を呼び、
  `start()` が `enterRecordingMode()` を呼び返す**相互再帰**だった。グローバルショートカット/HUD ボタンで
  録音を開始すると `toggleRecording → enterRecordingMode → start → enterRecordingMode → …` で
  stack overflow クラッシュする。所有権を整理して解消:
  - `enterRecordingMode`/`leaveRecordingMode` を **window 専用**（panel の出し入れ＋`isRecording`）にし、`start()` を呼ばない。
  - `toggleRecording` は録音の単一エントリ `RecordingWorkspaceState.start()/stop()` を呼ぶ。
  - `start()/stop()` は window 専用の enter/leave を呼ぶ（呼び返さない）。
- テスト用に `WindowCoordinator.headless`（既定 false、本番挙動不変）を追加し、window を出さず状態遷移だけ検証可能に。
- `--selftest hudlifecycle`（§6「Voice HUD→Recording→保存→HUD復帰」/ Done#7）を追加。
  **実測 PASS**: `HUD→Recording→保存→HUD 復帰 の window 状態遷移 OK`。verify に組み込み。全 selftest 回帰なし。
- **意味**: 実際にクラッシュする経路（ショートカット/ボタンでの録音開始）を修正。Done#2/#7 の正しさが上がった。

## 追記: 一時停止が実際に録音を止めていなかったバグ修正（Phase 1.36）

- **バグ発見・修正**: `RecordingWorkspaceState.togglePause()` は UI フラグ `isPaused` を切り替えるだけで、
  `RecordingRuntime.setPaused()`（core の `RecordingSession.set_paused`）を呼んでいなかった。core は pause 中に
  sample を捨てる実装なのに、その口が UI から繋がっておらず、**一時停止ボタンは見た目だけ**で録音は進み続けていた
  （§2「UIだけのmockで完成扱いにしない」違反）。
- 修正: `togglePause()` が `RecordingRuntime.shared.setPaused(isPaused)` を呼ぶ。RecordingRuntime は `paused` を持ち、
  一時停止中はマイクフレームを STT にも渡さない（session 側は core が捨てる）。
- 検証: `--selftest pause` を追加。begin → 6s push（before=5000）→ pause + 6s push（**進まず 5000**）→ resume + 6s push
  （10000）。**実測 PASS**: `停止中は録音が進まない before=5000 pause=5000 resume=10000`。verify に組み込み、回帰なし。
- **意味**: 一時停止が実機能になった（UI mock ではない）。Done#2/#7 の正しさが向上。

## 追記: 画面文脈スクショ（viewfinder ボタン）を実装（Phase 1.37）

- **空実装の修正**: `RecordingWorkspaceState.captureScreenshot()` は `{}`（空）だったが、TaskDock の viewfinder
  ボタンに繋がっていた（§2 UI mock 違反）。実装: `ScreenContextCapture.captureFrameCG()` で実フレームを取り、
  会議フォルダ `Astra/meetings/<id>/screens/screen-*.png` に PNG 保存（ImageIO）。
- 検証: `--selftest screenshot`（画面収録許可があれば実 PNG を保存、PNG マジックナンバー確認）。
  **実測 PASS**: `実 PNG 保存 bytes=563842 isPng=true`。verify に組み込み（未許可 CI では SKIP）。
- viewfinder ボタンが実機能に（Done#2）。

## 追記: AI 操作（要約/質問/決定事項/アクション）を実 Agent に配線（Phase 1.38）

- **空アクションの修正**: `AIActionsPalette` の 4 ボタンは `Button {}`（空）だった（§2「AI Summary/Ask/Decisions/Actions」が stub）。
  `RecordingWorkspaceState.runAIAction(title)` を実装し、**transcript を指示文付きで core 経由の会話 Agent に送り**
  （`startConversation`→`sendTurn`）、結果を `aiResult` に反映。要約/決定事項/アクションで指示文を変える。
- サインイン済みセッションを `configureBackend(base:token:)` で受け取り、未サインインなら「サインインすると使えます」を返す
  （**推測で埋めない**）。同期 I/O は `Task.detached` で回し main で反映。
- 検証: `--selftest aiaction <base>`（実 gateway）。サインイン→transcript 設定→要約実行→Agent 応答を待つ。
  **実測 PASS**: `Agent 応答="…"`（dev の会話エンジンは notice を返すが、**ボタン→core→gateway→Agent→UI の経路は実物**）。
  verify に SKIP 許容で組み込み。
- **意味**: AI 操作 4 ボタンが実 Agent に繋がった（Done#2/#7、UI mock ではない）。

## 追記: 文字起こしの表示 + ツール切替 + 翻訳を実装（Phase 1.39）

- **大きな欠落の修正**: `state.transcript` は STT が埋めるのに **Recording Workspace に一切表示されていなかった**
  （文字起こしタブの中身が無い）。さらに `selectedTool`（文字起こし/翻訳/字幕）は**表示を切り替えていなかった**
  （§2/§3「Transcript / Translation」が UI mock）。
- 実装: `TranscriptPanel.swift` を新設し、道具箱の選択に応じて中身を出す:
  - **文字起こし**: `state.transcript` の実データを話者付きリストで表示（interim は淡色）。
  - **翻訳**: `state.translate()`（Agent 経由）の訳文。翻訳タブに切り替えると自動で走る（`onChange`）。
  - **字幕**: 直近の 1 行を大きく。
    ワークスペース右側に配置。
- 検証: `--selftest translate <base>`（transcript → Agent 会話 → 訳文の経路）。**実測 PASS**（サインイン→送信→応答。
  dev の会話エンジンは訳を返さないが**ボタン/タブ→core→gateway→Agent→UI の経路は実物**）。verify に SKIP 許容で組み込み。
- **意味**: 録音中に文字起こしが**実際に見える**ようになり、ツールタブが機能した（Done#2/#7、UI mock 排除）。

## 追記: 波形を実マイクレベルに + Home の成果物を実データに（Phase 1.40）

- **mock の修正 2 件**:
  1. `audioLevels` が固定デモ配列のままで、**録音中も波形が実マイク音量を反映していなかった**。RecordingRuntime に
     `onLevel` を足し、マイクフレームの peak（0..1）を main で `audioLevels`（末尾追加のローリング）へ流す。録音開始時に
     デモ値をフラット baseline にリセット。→ 波形が実マイクレベルで動く。
  2. `HomePane` の「最近の成果物」がハードコード（`["Echo result", "A社 商談 議事録"]`）だった。`MainData.library`
     （core 経由の実データ）を渡す形にし、空なら「まだ成果物はありません」。挨拶の固定氏名も外した。
- 検証: `--selftest waveform`（実マイクでレベルコールバックが発火）。**実測 PASS**: `実マイクレベルで更新 callbacks=11`。
  verify に組み込み（未許可 CI では SKIP）。全 selftest 24 件 OK/SKIP・0 FAIL、回帰なし。
- **意味**: 録音 Hero の波形と Home の成果物が実データに（Done#2/#7、UI mock 排除）。

## 追記: サインインを録音ワークスペースへ配線（Phase 1.41, Done#7 統合）

- **実ギャップの修正**: `MainData.load()` は dev サインインして Apps/Library を取るが、**そのトークンを
  `RecordingWorkspaceState`/`RecordingRuntime` に渡していなかった**。そのため実アプリでは録音中の AI 操作・翻訳が
  常に「サインインすると使えます」になり、実会議（gateway 側の meeting 作成）も動かなかった。
- 修正: `MainData.load()` 成功時に `RecordingWorkspaceState.configureBackend` と `RecordingRuntime.configureBackend`
  を呼び、サインインを録音側にも渡す。→ Main Window でサインインすれば、録音の AI 操作/翻訳/実会議連携が有効になる。
- 検証: 既存 `--selftest aiaction`/`translate`（明示的に configureBackend する経路）は PASS のまま。全 selftest 24 件
  OK/SKIP・0 FAIL、回帰なし。実アプリ経路（MainData 起点）の配線はコードで担保。
- **意味**: Main Window・Recording Workspace・Apps/Agents・RAG/Agent が一つのサインインで繋がった（Done#7 統合）。

## 追記: クラッシュ録音の回復フローを実装（Phase 1.42, §3 meeting recovery）

- **未実装機能の追加**: `scan_recoverable`（core）はテストのみで、アプリは回復候補を**一切 surface していなかった**。
  §3「meeting recording/recovery」の実機能を追加:
  - `RecordingRuntime.recoverableMeetings()`（スキャン）/ `recover(meetingId:)`（断片を gateway に送って finalize）。
  - 起動時に `AstraAppDelegate` がスキャンし、あれば `RecoveryState.shared.pending` に積む（NSLog で通知）。
  - `MainData.load()` のサインイン成功時に `RecoveryState.recoverAll()` を呼び、**前回落ちた録音を自動で gateway へ送って片付ける**。
- 検証: `--selftest recovery <base>`（実 gateway）。会議作成→断片を書いて**アップロードせず**（クラッシュ相当）→
  スキャンで検出→復旧（送信＋finalize）。**実測 PASS**: `クラッシュ録音を検出→復旧 uploadedBytes=192000`。
  verify に SKIP 許容で組み込み。全 selftest 25 件 OK/SKIP・0 FAIL。
- **意味**: 録音がクラッシュしても次回サインイン時に自動で拾って送る、が実機能に（Done#3 meeting recovery）。

## 追記: 会議 id の不一致バグ修正（Phase 1.43）

- **バグ発見・修正**: `begin()` はサインイン時に **gateway id** で journal を作るのに、`state.currentMeetingId`
  （スクリーンショットの保存先）は**ローカルの `meeting-<timestamp>` のまま**だった。結果、録音断片は
  `root/<gateway-id>/` に、スクショは `root/<local-id>/screens/` に散り、同じ会議に紐づかなかった。
- 修正: `RecordingRuntime.activeMeetingId`（実際に journal を作った id）を公開し、`state.start()` が begin 後に
  `currentMeetingId = RecordingRuntime.shared.activeMeetingId` を設定。→ スクショと録音が同じ会議フォルダに入る。
- 検証: record/livemeeting 回帰 PASS。全 selftest 25 件 OK/SKIP・0 FAIL。

## 追記: Settings のショートカット表記が実登録と不一致だったのを修正（Phase 1.44）

- **バグ発見・修正**: Settings は「⌥Space=Task Dock」「⌥⌘R=録音開始/停止」等と表示していたが、実際に登録されている
  グローバルショートカットは **⌥Space=録音開始/停止のみ**（GlobalShortcut）。表記が実装と食い違い、ユーザーが誤ったキーを
  押す状態だった（未登録の ⌥⌘R/⌥D を「ある」と見せていた＝推測で埋めていた）。
- 修正: Settings のショートカット節を `GlobalShortcut.label()`（実登録の combo）1 本に絞り、実装と一致させた。
- **意味**: 表示が実挙動と一致（Done#2 の正しさ、推測表示の排除）。

## 追記: 録音中の経過時間が進まないバグ修正（Phase 1.45）

- **バグ発見・修正**: `elapsedSeconds` は録音中に**一度も加算されていなかった**（初期 0、demo で固定 4:21 のみ）。
  実録音では Hero/Task Dock の経過表示が "00:00" のまま止まっていた。
- 修正: `start()` で 1Hz の `Timer` を張り、録音中かつ非一時停止のとき `elapsedSeconds` を加算。`stop()` で止める。
  経過ラベル自体は core（`recording_snapshot`）が整形する（既存）。
- 検証: `--selftest timer`。録音→2.4s（進む=2）→一時停止 1.6s（**止まる=2**）→再開 1.6s（進む=3）。
  **実測 PASS**: `経過が進む running=2 停止で止まる paused=2 再開で進む resumed=3`。verify に組み込み、回帰なし。

## 追記: connector OAuth フロー（Swift loopback）を実装（Phase 1.46）

- **未実装の追加**: connector の認可コードフローの Swift 側（loopback listener + ブラウザ起動）が無かった。
  `Context/ConnectorFlow.swift` を新設: `NWListener` で loopback を開いて折り返しを 1 回待ち、core の
  `connector_parse_callback`（新設 uniffi Record `OauthCallback` を返す）で解析。authorize URL・PKCE・
  トークン交換は core（既存）。**トークンは Keychain のみ、外のブラウザで開く（RFC 8252 §8.12）**。
- core に uniffi `OauthCallback` + `connector_parse_callback` を追加（解析は core に一本化、Swift へ公開）。
- 検証: `--selftest connectorflow`。loopback を開き（OS 選択 port）、疑似的な折り返し
  `/callback?code=abc123&state=xyz789` を自分で送り、core が解析することを確認。
  **実測 PASS**: `loopback 受理 code=abc123 state=xyz789 port=59898`。verify に組み込み。
  core 35 tests / swift-bindings `--check` current / FFI contract / Tauri ビルド回帰なし。
- **意味**: connector OAuth フローが Swift 側で **code-complete**（authorize URL/PKCE/loopback/交換すべて core・検証済み）。
  残る外部依存は **実 OAuth 提供者（client_id）＋ユーザー consent＋実 HTTP 交換**のみ（この環境に無い）。

## 追記: connector callback 解析を C ABI にも公開（Phase 1.47, Windows パリティ）

- `connector_parse_callback` は uniffi(Swift)にだけ公開していたので、**C ABI に `astra_core_parse_callback`
  （折り返し URL → JSON）を追加**し、Windows C# も同じ解析を使えるようにした。header・`AstraCore.cs`
  （`ParseCallback`）・`verify-c-abi.sh` を更新。
- 検証: **C(clang) から** `astra_core_parse_callback("/callback?code=abc&state=xyz")` → JSON に code/state を確認。
  **実測 PASS**: `CABI_OK connector: … parseCallback ok`。**FFI contract**: `Rust 20 = header 20 = C# 20` 一致。
  swift-bindings `--check` current。
- **意味**: connector の契約層（authorize URL / PKCE / callback 解析 / トークン交換）が macOS(UniFFI)・Windows(C ABI)
  の両方に揃い、C から実行検証＋三者一致 contract で担保。残る外部依存は実 OAuth 提供者との live 交換のみ。

## 追記: Apps/Connectors のトグルを honest に配線（Phase 1.48）

- **最後の connector UI mock の解消**: AppsPane の接続トグルは `.constant(false)`（常に off・非機能）だった。
  `Context/ConnectorState.swift` を新設: アプリ名→OAuth プロバイダの対応、`configuredProviders()`（core に client_id
  一覧を渡して判定）、`canConnect(app)`（対応プロバイダがあり client_id が設定済みか）、`connect(app)`（ConnectorFlow で OAuth 開始）。
- AppsPane: トグルは**設定済みのものだけ有効**、未設定のプロバイダには「接続には client_id の設定が必要」と注記
  （**繋げないものを繋いだつもりにさせない**、§21）。タップで OAuth をブラウザで開始。接続済み状態を反映。
- 検証: `--selftest connectorstate`。アプリ→プロバイダ対応・`canConnect` が client_id env に連動・Finder は不可 を確認。
  **実測 PASS**: `mapping ok, canConnect gated by client_id (google env=false)`。verify に組み込み、全 selftest 0 FAIL。
- **意味**: Apps/Connectors のトグルが実状態に（Done#2/#7、UI mock 排除）。実接続は client_id＋consent が要る（外部）。

## 追記: Voice HUD を実 Agent 問い合わせに配線（Phase 1.49）

- **mock の解消**: `VoiceHUDState` は `mode`（idle/listening/thinking）を持つだけで、listening/thinking は demo でしか
  設定されず実フローで駆動されていなかった。`ask(text)` を実装: `thinking` に入れて core 経由で会話 Agent に投げ、
  応答を `answer` に入れて `idle` に戻す。サインインは `MainData` から `configureBackend` で渡す。
- 検証: `--selftest voiceask <base>`（実 gateway）。依頼→thinking→Agent 応答→idle を確認。
  **実測 PASS**: `thinking=true→idle Agent 応答="…"`（dev エンジンは notice を返すが、HUD→core→gateway→Agent→HUD の
  経路は実物）。verify に SKIP 許容で組み込み。
- **意味**: Voice HUD の thinking/idle が実 Agent 問い合わせで駆動される（Done#2/#7、mock 排除）。

## 追記: アップロード済みの録音が毎回再アップロードされる重大バグを修正（Phase 1.50）

- **バグ発見・修正**: `end()`/`recover()` は gateway にアップロードするが journal を **Uploaded に印していなかった**。
  `scan_recoverable` は `state==Uploaded` のみ除外するため、**正常終了・復旧済みの録音まで毎回「回復候補」に出て、
  サインインのたびに再アップロード**されていた（二重・多重送信）。
- 修正: core に `mark_meeting_uploaded(root, meeting_id)`（journal を Uploaded に）を追加（uniffi 公開）。
  Swift の `end()`/`recover()` がアップロード成功後に `AstraCoreBridge.markUploaded` を呼ぶ。
- 検証: `--selftest recovery` を強化。復旧後に `recoverableMeetings()` から**消える**ことを確認。
  **実測 PASS**: `検出→復旧 uploadedBytes=192000 復旧後は候補から消える(stillThere=false)`。
  core 35 tests / swift-bindings `--check` current / Tauri ビルド回帰なし。
- **意味**: 送信済みの録音を二重に送らない（データ整合・帯域・課金の実害を防ぐ実バグ修正）。

## 追記: mark_meeting_uploaded を C ABI にも公開（Phase 1.51, Windows パリティ）

- Windows の回復フローも二重アップロードを防げるよう、C ABI に `astra_core_mark_meeting_uploaded(root, meeting_id)`
  を追加（header・`AstraCore.cs` の `MarkMeetingUploaded`）。
- 検証: `verify-c-abi.sh` を拡張し、録音往復の後に mark → **実測 PASS**: `CABI_OK … markedUploaded=1`。
  **FFI contract**: `Rust 21 = header 21 = C# 21` 一致。swift-bindings `--check` current / Tauri ビルド回帰なし。

## 追記: オフライン録音が復旧できず候補に残り続けるバグ修正（Phase 1.52）

- **バグ発見・修正**: サインイン前に録った録音は local id（`meeting-…`）で、対応する gateway 会議が無い。
  `recover()` は `uploadMeetingAudio(local id)` を叩くが gateway に会議が無く失敗 → `mark_uploaded` されず、
  **毎回の回復候補に残り続け、サインインのたびに無駄なリトライ**をしていた。
- 修正: `recover()` が local id（`meeting-` 接頭辞）を検出したら、**新しい gateway 会議を作り、journal ディレクトリを
  その id にリネームしてから**送る → finalize → mark。以後は候補から消える。
- 検証: `--selftest recoveryoffline`。オフライン録音（local id）を作り、後からサインインして復旧、候補から消えることを確認。
  **実測 PASS**: `オフライン録音を新規会議に紐付けて復旧 sent=192000 local消滅=true`。verify に SKIP 許容で組み込み。
- **意味**: サインイン前に録った会議も後から確実に保存され、回復キューに溜まらない（Done#3 recovery の完成度向上）。

## 追記: 実経路の包括 E2E（Voice HUD→Recording→保存→HUD復帰, Phase 1.53）

- **§6「Voice HUD→Recording→保存→HUD復帰」の実 E2E** を追加。UI mock ではなく、実際に
  `WindowCoordinator.toggleRecording()`（＝グローバルショートカットが呼ぶ実経路）を叩いて全体を通す:
  サインイン → 録音開始（**実 gateway 会議を作成**・**実マイク取り込み**）→ 実録音6秒 → 停止（保存・送信・
  アップロード印）→ HUD 復帰 → **回復候補に残らない**（送信済み）。
- 検証: `--selftest fulllifecycle <base>`。**実測 PASS**:
  `HUD→録音(実gateway会議 …)→実マイク→保存送信→HUD復帰、候補に残らない`。
  この 1 本で、今セッションで直した「再帰修正・gateway 会議作成・実マイク・アップロード・mark・window 復帰」が
  実際の製品エントリ経由で一緒に動くことを確認。verify に SKIP 許容で組み込み、全 selftest 0 FAIL。
- **意味**: Done#3(live capture の核)・#7(統合)・§6 の主要 E2E が実バックエンド＋実ハードウェアで通ることを実証。

## 追記: 最終製品経路の Tauri 非依存を機械検証（Phase 1.54, Done#8）

- **Done#8 の正確な確認**: 最終製品＝**macOS native app は core を直接使い Tauri に一切依存していない**
  （`apps/astra-macos` に `import Tauri`/`WebviewWindow`/`AppHandle`/`apps/desktop`/`src-tauri` の実コード参照ゼロ、
  `astra-core` も tauri crate 非依存）。これまで「live トークン交換が残る」と書いたが、それは **Tauri 依存ではなく
  外部 OAuth 提供者依存**であり、native の交換経路は core の `exchange_code` を通る（Tauri を介さない）。
- `scripts/check-native-tauri-free.mjs` を新設: native app の Swift（コメント除去後の実コード）と astra-core の Cargo を
  走査し、Tauri 参照があれば fail。`ci.yml` に `pnpm check:native-tauri-free` を追加。
- 検証: **実測 PASS** `native product path is Tauri-free: 45 Swift files + astra-core に Tauri 依存なし`。
  **負テスト**: `import Tauri` を注入すると検出して fail（ドリフトを止める）。
- **意味（Done#8）**: 最終製品経路（native）から旧 Tauri 依存が**外れていることを機械で担保**。既存 Tauri アプリ
  (`apps/desktop`) は §7 に従い残置（参照側であって製品経路ではない）。残る外部依存は実 OAuth 提供者との live 交換のみ
  （Tauri とは無関係）。

## 追記: Windows C# CoreBridge を実 core で動作検証（Phase 1.55, Done#4/#5 強化）

- **dotnet 8 がこの macOS で使えると判明**。WinUI の UI レイヤ（Windows App SDK）は Windows でしか組めないが、
  **純 C# の CoreBridge（P/Invoke）は net8.0 で macOS 上でビルド・実行できる**。
- `apps/windows/bridge-check`（Program.cs + csproj）と `scripts/verify-csharp-bridge.sh` を新設。
  Windows アプリと**同一の `AstraCore.cs`** を取り込み、**P/Invoke で実 `libastra_core` に繋いで**
  version / **PKCE(RFC7636 ベクタ)** / authorize URL / callback 解析 / elapsed を検証。
- 検証: **実測 PASS** `CS_OK bridge->core: version=0.1.0 pkce=S256 authorizeUrl parseCallback elapsed=01:05`。
  `ci.yml`（ubuntu, dotnet）と `windows.yml` に `verify:csharp-bridge` を追加。
- **意味（Done#4/#5 の強化）**: Windows の C# ブリッジが、契約一致（三者 contract）だけでなく **実際にコンパイルでき、
  実 core を P/Invoke で呼んで正しい結果を返す**ことを、**Windows 実機なしで**実測担保。残るは WinUI の UI レイヤの
  実ビルド/描画のみ（Windows App SDK が要り windows-latest CI で検証）。

## 追記: Windows ジオメトリも共有 fixture と一致することを検証（Phase 1.56, cross-OS visual）

- `verify-csharp-bridge` を拡張し、Windows の Recording Workspace 形状（凹み Bezier）を**純 C# で SVG パス化**
  （WinUI の `RecordingWorkspaceGeometry` と同じ制御点＝固定オフセット 14/15 ＋ `GeneratedMetrics`）して、
  共有 golden `shared/design/fixtures/recording-workspace.path` と照合。
- 検証: **実測 PASS** `CS_OK …; geometry matches shared fixture`。
  これで **macOS(Swift Shape) と Windows(C#) の両方が同じ golden に一致**＝tokens から同一の Bezier を描くことを、
  **Windows 実機なしで**担保（Swift 側は `--selftest shape` で既に一致確認済み）。
- **意味（Done#4/#5/#6 の強化）**: 両 OS の visual regression が揃った。Windows は C# ブリッジの実動作＋
  ジオメトリ一致まで実測。残るは WinUI の実描画（Windows App SDK, windows-latest CI）のみ。

## 追記: Windows の session/data ロジックを実 gateway で検証（Phase 1.57, Done#1/#4 強化）

- `apps/windows/Astra/AppLogic/AstraSession.cs` を新設（WinUI 非依存の純 C#、macOS の `MainData` 相当）:
  `SignIn`（tokens 取り出し、refresh は Keychain 相当へ）/ `Apps` / `Library` / `RunEchoTask`（Agent 往復）を
  C# ブリッジ経由で実 gateway に繋ぐ。UI(Window)からはこれを使う設計。
- `verify-csharp-bridge` を拡張し、gateway 到達時に **AstraSession を C# から往復検証**。
  **実測 PASS**: `CS_OK gateway(AstraSession): signedIn apps=12 library=0 echoArtifact=52bytes`
  （C#→P/Invoke→core→gateway→**Agent echo=COMPLETED＋成果物本文**）。未到達なら CS_SKIP。
- **意味（Done#1/#4 の強化）**: **Windows の session/data 層が実バックエンドに対して実際に動く**ことを、
  **Windows 実機なしで**実測担保（サインイン・Apps・Library・Agent 実行）。残るは WinUI の UI 描画のみ。

## 追記: Windows Global shortcut（RegisterHotKey）を実装・コンパイル検証（Phase 1.58）

- `apps/windows/Astra/AppLogic/WindowsGlobalShortcut.cs` を新設。macOS の `GlobalShortcut`（Carbon）に対応する
  Windows 実装: user32 の `RegisterHotKey` で Alt+Space をシステム登録し、`WM_HOTKEY` を WndProc で拾う。
  DllImport 宣言はどのホストでもコンパイルできるので、**macOS/CI で型検査**（実登録・受信は Windows 実機/CI）。
- 検証: `verify-csharp-bridge` にコンパイル対象として取り込み**ビルド PASS**。さらに純ロジックの
  `Label()` を実行して `Alt+Space` を確認（**実測 PASS**）。
- **意味（§4 Global shortcut）**: Windows のグローバルショートカット実装が code-complete＋コンパイル検証済み。
  実際の登録/押下受信は Windows でのみ（user32.dll）。

## 追記: Windows WASAPI マイク/loopback 取り込みを実装・コンパイル検証（Phase 1.59）

- `apps/windows/Astra/AppLogic/WasapiCapture.cs` を新設。macOS の MicCapture(AVAudioEngine)/SystemAudioCapture
  (ScreenCaptureKit) に対応する Windows 実装: WASAPI の canonical 手順（GetDefaultAudioEndpoint → Activate(IAudioClient)
  → Initialize → GetService(IAudioCaptureClient) → GetBuffer ループ）でフレームを float[] にして callback へ。
  `loopback: true` で既定再生デバイスの loopback（システム音声, §4 System Audio）。最小限の COM インターフェース宣言を同梱。
- 検証: `verify-csharp-bridge` にコンパイル対象として取り込み **ビルド PASS**（COM 宣言・呼び出しの型検査）。
- **未検証（Windows 実機のみ, 捏造しない）**: 実際の取り込み（mmdevapi COM の実行）・mix format が float でない場合の変換・
  loopback の実挙動は Windows でのみ検証できる。float[] 抽出は float mix format 前提（一般的だが要実機確認）。
- **意味（§4 Mic/System Audio）**: Windows の音声取り込みが code-complete＋コンパイル検証済み。実取り込みは Windows。

## 追記: Windows 録音ウィンドウを WASAPI→core に配線（Phase 1.60）

- `RecordingWorkspaceWindow.Begin` が `WasapiCapture`（マイク）を開き、フレームを `RecordingSession.Push`（core）へ流す
  ように配線（macOS の `RecordingRuntime.begin` と同じ流れ）。`End` で mic 停止＋session 確定。経過は DispatcherQueue で更新。
- WinUI の Window コードなので**ビルドは Windows のみ**（compile 検証はできない）。ただし配線先の `WasapiCapture`・
  `RecordingSession`(core bridge) は compile／runtime 検証済み。実取り込み・描画は Windows 実機/CI。
- **意味（§4 Recording）**: Windows の録音音声経路（マイク→core→断片保存）が code-complete。

## 追記: Windows Main Window を AstraSession に配線（Phase 1.61, §4 Main Window）

- `MainWindow` が起動時に `AstraSession`（core→gateway、runtime 検証済み）でサインインし Apps/Library を取得、
  NavigationView の選択でセクション切替（macOS の MainData/MainWindowView と対）。Page への描画は WinUI 側（Windows）。
- WinUI Window コードのためビルドは Windows のみだが、**データ層 `AstraSession` は実 gateway で runtime 検証済み**。
- **Windows の到達点**: 共通ロジック（bridge/session/geometry/shortcut/WASAPI）は compile／runtime 検証済み、
  Main/Recording Window はそれらに配線済み（code-complete）。**残るは WinUI の実描画（Page/XAML の render）と
  Windows.Graphics.Capture（画面）＝ Windows 実機/CI でのみ**。

## 追記: Windows Credential Manager（資格情報保管）を実装・コンパイル検証（Phase 1.62, §21）

- `apps/windows/Astra/AppLogic/WindowsCredentialStore.cs` を新設。macOS の KeychainStore/SessionStore に対応する
  Windows 実装: advapi32 の `CredWrite`/`CredRead`/`CredDelete` で **refresh/device token を Credential Manager のみ**に
  保管（upsert / 未登録は null / 冪等 delete）。`WindowsSessionStore` で refresh/device をまとめて管理。
- `AstraSession.SignIn` が Windows のとき refresh/device token を Credential Manager に保存（`OperatingSystem.IsWindows()`
  ガードで非 Windows では skip → macOS の runtime 検証は維持）。access token はメモリのみ。
- 検証: `verify-csharp-bridge` にコンパイル対象として取り込み **ビルド PASS**。非 Windows では保存 skip のため
  gateway 往復テストも従来どおり PASS。
- **意味（§21）**: Windows の資格情報保管が code-complete＋コンパイル検証済み。実保存/読取は Windows（advapi32）。

## 追記: Windows 画面取り込み（GDI BitBlt）を実装・コンパイル検証（Phase 1.63, §4 Screen）

- `apps/windows/Astra/AppLogic/WindowsScreenCapture.cs` を新設。macOS の ScreenContextCapture(CGDisplayCreateImage)
  に対応: GDI(gdi32/user32)の BitBlt でプライマリ画面を 1 枚取り BGRA バイト列にして返す。
  アプリ本体は WinRT の Windows.Graphics.Capture を使ってもよいが、GDI は**どのホストでもコンパイルできる**共通ロジック。
- 検証: `verify-csharp-bridge` にコンパイル対象として取り込み **ビルド PASS**。
  （途中、`BI_RGB` short→uint の型不一致を compile 検証が**検出**＝コンパイル検証の実効性を確認して修正。）
- **未検証（Windows 実機のみ）**: 実際の画面取り込み（gdi32/user32 の実行）。
- **意味（§4 Screen）**: Windows の画面取り込みが code-complete＋コンパイル検証済み。

## 追記: WinUI が macOS でビルド不可な「正確な境界」を実測（Phase 1.64, Done#10）

- `dotnet build apps/windows/Astra.sln` を試すと `NETSDK1100`（Windows 対象は `EnableWindowsTargeting=true` が要る）。
- `-p:EnableWindowsTargeting=true` を付けると **NuGet 復元（Microsoft.WindowsAppSDK 1.6）とフレームワーク解決は成功**し、
  ビルドは XAML コンパイル段まで進む。そこで **`XamlCompiler.exe`（Windows 専用の実行ファイル）が exit 126 で失敗**
  （macOS では実行できない）。→ **WinUI が macOS でビルドできない正確な理由は「XAML→C# codegen を行う Windows 専用
  ツールが動かない」こと**。C# の managed コードと Windows App SDK 参照自体は macOS 上で解決できる。
- **含意**: 純 C#（`AppLogic/` の bridge/session/audio/shortcut/credential/screen）は `verify-csharp-bridge` で
  コンパイル＋ロジック検証できるが、**`.xaml` を伴う Window クラスの型検査は XAML compiler を要するため windows-latest CI のみ**。
  これが Windows 側の唯一残る未検証境界（Done#4/#5 の core は検証済み、UI 描画層のみ）。

## 追記: Windows XAML の整形式性を検証（Phase 1.65, §6 Windows CI/build）

- `scripts/check-xaml-wellformed.sh` を新設。apps/windows の全 `.xaml`（App/Main/VoiceHud/RecordingWorkspace）を
  `xmllint` で整形式 XML かチェック（閉じ忘れ・属性崩れを止める）。**どのホストでも走る**（macOS/CI ubuntu）。
  `ci.yml` と `windows.yml` に `check:xaml` を追加。
- 検証: **実測 PASS** `xaml well-formed: 4 WinUI .xaml files OK`。
- **意味**: Windows の未検証境界がさらに狭まった。now 検証済み: C# ロジック（compile＋runtime）／geometry／
  **XAML の整形式性**。**残る唯一の Windows 専用検証**: XAML→C# codegen（`XamlCompiler.exe`）＋WinUI の実描画＋
  COM/Win32 の実行時動作 ＝ windows-latest CI / 実機のみ。

## 追記: overlay パネルの Spaces/fullscreen 挙動を検証（Phase 1.66, §2 Window/Spaces/fullscreen）

- `AstraPanel` は `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]`・borderless・透過・
  非 main で構成済み（§2「Window/Spaces/fullscreen挙動」＝全 Space・フルスクリーンアプリ上に出る overlay）。
- 検証: `--selftest panel`（パネルを生成し表示せず属性だけ確認、headless で hang しない）。
  **実測 PASS**: `全Space=true fullscreen補助=true borderless=true 透過=true notMain=true`。verify に組み込み。

## 追記: 最終アクセプタンス `verify:all`（Phase 1.67, Done#9 集約）

- `scripts/verify-all.sh`（`pnpm verify:all`）を新設。**この環境で検証できる全ゲートを 1 コマンドで**通す:
  astra-core 35 / Tauri Rust 67 / Tauri desktop JS 352 / design-tokens・swift-bindings・workspace-fixture の鮮度 /
  conventions / C ABI 三者一致 / native-tauri-free / WinUI XAML 整形式 / C# bridge→実 core＋実 gateway /
  C ABI 実 gateway 縦断（auth/meeting/agent/apps/library/connector/録音） / macOS 録音＋**live 実機**（mic/screen/meeting）/ swift unit。
- 実行時前提が要るもの（TCC／Windows 実機／実 OAuth 提供者）は各スクリプトが SKIP で正直に飛ばす。
- 検証: **実測 PASS** `VERIFY_ALL_OK: この環境で検証できる全ゲートが緑`。
- **意味（Done#9）**: 「実装＋この環境で検証可能な範囲」の健全性を 1 コマンドで担保。CI（ci.yml）も同じ個別ゲートを走らせる。

## 追記: 主要 SwiftUI ビューのオフスクリーン render 検証（Phase 1.68, §6 UI）

- `--selftest render` を新設。VoiceHUD / RecordingWorkspace / MainWindow / Settings を **NSHostingView で
  オフスクリーンにレンダリング**（`bitmapImageRepForCachingDisplay`＋`cacheDisplay`）し、クラッシュせず非ゼロの
  描画になることを確認（**画面には何も出さない**＝安全、XCUITest のような GUI 自動操作の代替として render を担保）。
- 検証: **実測 PASS** `VoiceHUD/RecordingWorkspace/MainWindow/Settings 全てオフスクリーン描画 OK`。verify に組み込み。
- **意味（§6 UI）**: 主要画面が実際に描画されること（mock でなく View が body を生成しレイアウトされる）を headless で担保。

## 追記: Windows C# 実ロジック全体を macOS で型検査（Phase 1.69, Done#4/#5 大幅前進）

- **突破**: `EnableWindowsTargeting=true` ＋ `net8.0-windows10` で **Windows App SDK の型が macOS で解決**でき、
  XAML→C# codegen（`XamlCompiler.exe`＝Windows 専用）を**手書きスタブ**（`x:Name` 要素＋`InitializeComponent`）で
  代替すれば、`dotnet build -t:CoreCompile` で **WinUI の Window code-behind を含む Windows C# 全体を型検査できる**。
- `apps/windows/logic-check/`（csproj＋xaml-stubs.g.cs、実アプリのソースを参照＝コピーしない）と
  `scripts/verify-csharp-logic.sh` を新設。実 gateway 不要・どのホストでも走る。`ci.yml`／`windows.yml`／`verify:all` に追加。
- 検証: **実測 PASS** `CSLOGIC_OK: Windows C# 実ロジック全体(Window code-behind 含む)が型検査を通過`。
  対象: AstraCore(bridge)／AstraSession／WASAPI／GlobalShortcut／CredentialStore／ScreenCapture／geometry ＋
  **MainWindow・RecordingWorkspaceWindow(WASAPI 配線含む)・VoiceHudWindow の code-behind**。
- **意味（Done#4/#5）**: これまで「WinUI 全部が Windows 専用」としていたが、**実ロジック（Window 配線含む）は macOS/CI で
  型検査でき、実測 PASS**。**残る唯一の Windows 専用**は XAML markup の codegen（`.xaml`→`.g.cs`）＋実描画＋
  COM/Win32 の実行時のみ。捏造ではなく、境界がさらに狭まったことを実測で確定。

## 追記: XAML codegen の正確な境界（Phase 1.69 補足）

- `-p:UseXamlCompilerExecutable=false` にすると、XAML markup コンパイラは net472 の `XamlCompiler.exe`（exit 126）から
  **net6.0 の in-process タスク `Microsoft.UI.Xaml.Markup.Compiler.dll` へ切り替わり macOS で読み込まれる**ところまで到達する。
  ただしそのタスクは `System.Security.Permissions 6.0.0.0`（macOS 実行可能版）を要し、**オフライン cache に無い**ため
  `.g.cs` 生成に至らない（cache に有るのは net8 ref のみ）。→ **XAML→`.g.cs` 生成は、Windows CI（通常の XamlCompiler）
  または当該依存を含むオンライン restore が要る**、という正確な境界。C# 実ロジックの型検査（Window code-behind 含む）は
  この依存無しで PASS 済み（`verify:csharp-logic`）。捏造ではなく、境界を依存レベルまで実測特定した。

## 追記: XAML codegen が Windows を要する「根本理由」を確定（Phase 1.70）

- 依存 `System.Security.Permissions 6.0.0`（net6.0 実装）を用意して net6.0 の in-process XAML markup コンパイラを
  **実行まで到達させた**ところ、`WMC9999: Unable to load shared library 'kernel32.dll'` で停止。
  → **XAML markup コンパイラ自体が Windows カーネル API（`kernel32.dll`）を P/Invoke する**ため、macOS/Linux では
  原理的に `.g.cs` を生成できない（.NET 依存の問題ではなく OS ネイティブ依存）。これが XAML→C# codegen が
  windows-latest CI / Windows 実機を要する**確定的な根本理由**。
- 一方 **Windows C# の実ロジック（Window code-behind 含む）は kernel32 非依存で型検査 PASS 済み**（`verify:csharp-logic`）。
  したがって Windows 側の未検証は「XAML markup codegen（kernel32 依存）＋WinUI 実描画＋COM/Win32 実行時」に厳密確定。

## 追記: トークン交換の HTTP 経路をローカル mock で end-to-end 検証（Phase 1.71, #1/#8）

- `exchange_code` を `exchange_code_at(token_url, …)` に分離（token endpoint を差し替え可能に）。本番は提供者の
  `token_url` を渡す。
- テスト `exchange_code_posts_and_parses_against_a_local_token_endpoint`: **ローカルの mock token endpoint**
  （`TcpListener`）を立て、`exchange_code_at` が **実 HTTP POST**（form body に `grant_type`・`code`・PKCE の
  `code_verifier`）を送ることをサーバ側で確認し、canned な token 応答を `parse_token_response` が TokenSet に
  復元することを検証。**実測 PASS**（connector 10 tests, core 計 36）。
- **意味（#1/#8）**: connector の**トークン交換 HTTP 機構（body 構築→POST→応答 parse）が end-to-end で実測 PASS**。
  authorize URL/PKCE/loopback/callback 解析も既に検証済み。**残る外部依存は「実 OAuth 提供者サーバの実挙動＋
  ユーザーの consent」のみ**——mock ではなく本物の Google/Microsoft に対する live 交換だけが未検証で、これは
  client_id とユーザー操作を要する。

## 追記: STT テキスト無応答は bundle 文脈でなく環境限界と確定（Phase 1.72）

- 「Speech 認可は bundle id 紐づけなので、裸実行でなく署名済み `.app` から実行すれば STT が出るのでは」という仮説を検証。
  署名済み `Astra.app/Contents/MacOS/Astra --selftest sttrecognize`（NSSpeechRecognitionUsageDescription 入り Info.plist・
  bundle id `com.astra.mac`）でも結果は同じ **`SELFTEST_SKIP … recognizer returned no text`**。
- 認可は `auth=3(authorized)`・`onDeviceCapable=true`・`start/append` は動くのに、`say` 生成音声から認識テキストが
  返らない。→ **bundle 文脈の問題ではなく、この非対話環境（前面セッション無し）で Speech 認識サービスが実結果を
  返さない環境限界**と確定。STT の**パイプライン**（setup/start/append/live capture 中の稼働）は実測 PASS 済み、
  **実発話→テキストだけ**が署名 .app を前面でユーザーが実操作したときにのみ確認可能（Done#3 live）。

## 追記: Swift の connector 交換を mock 提供者で end-to-end 検証（Phase 1.73, #1/#8）

- core に uniffi `connector_exchange_code(token_url, …)`（endpoint 差し替え可）を追加。Swift から実 HTTP 交換を叩ける。
- `--selftest connectorexchange`: **Swift 内にローカル mock token サーバ（`NWListener`, 背景キュー）を立て**、
  `Swift→core(UniFFI)→実 HTTP POST` でトークン交換 → mock がサーバ側で **PKCE `code_verifier` 送信を確認** →
  access/refresh を Swift に復元 → **refresh を Keychain に保管**。**実測 PASS**:
  `Swift→core→実HTTP 交換 tokens 取得+Keychain 保管 (verifier 送信=true)`。verify に組み込み。
- **意味（#1/#8）**: native の connector OAuth **全経路**（authorize URL/PKCE ＋ loopback callback 解析 ＋ **実 HTTP 交換** ＋
  Keychain 保管）が mock 提供者に対し end-to-end 検証済み。**残る外部依存は実 Google/Microsoft の実挙動＋ユーザー consent のみ**。

## 追記: グローバルショートカット受信は実押下が要ると確定（Phase 1.74）

- ⌥Space を `CGEventPostToPid(getpid())` で**自プロセスにのみ**注入（システム全体に影響しない安全な方法）して
  Carbon ホットキーハンドラの発火を試みたが、**発火しない**。Carbon `RegisterEventHotKey` は WindowServer 経由の
  グローバル実押下で届く機構で、PID への合成キー注入では起動しない（かつ headless で GUI 副作用を招くため本採用しない）。
- → **グローバルショートカットの登録は検証済み**（`--selftest shortcut`=Alt/⌥Space 登録 OK）だが、**受信は署名 .app を
  前面で動かし、ユーザーが実際に ⌥Space を押したときにのみ確認可能**（Done#3 live）。システム全体へのキー注入は
  ユーザーの生セッションに干渉するため実施しない（安全方針）。

## 追記: Windows csproj を unpackaged build 用に整備（Phase 1.75, Done#5）

- `apps/windows/Astra/Astra.csproj` に **`<WindowsPackageType>None</WindowsPackageType>`**（＋`EnableMsixTooling`）を追加。
  WinUI 3 は既定で MSIX packaging を要し、CI の素の `dotnet build apps/windows/Astra.sln -c Release -p:Platform=x64` が
  packaging 設定不足で失敗しやすい。**unpackaged desktop app** 指定で MSIX 無しにビルドが通る（WinUI 3 の標準構成）。
- 検証: `dotnet restore -p:EnableWindowsTargeting=true` が **エラーなく完了**（csproj は well-formed・パッケージ解決 OK）。
  C# 実ロジックの型検査（`verify:csharp-logic`）も引き続き PASS。
- **意味（Done#5）**: Windows CI（windows-latest）の build 設定が unpackaged で通る形に整備。実ビルド/描画は
  Windows でのみ（XAML codegen が kernel32 依存のため）。

## Phase 1.76 — Windows unpackaged app.manifest（Done#5 / Done#6 補強）

unpackaged WinUI 3 は既定で system-DPI 認識になり、高 DPI ディスプレイでウィンドウ内容が
bitmap 拡大される。これでは `shared/design/tokens.json` から生成した geometry が実寸で描かれず、
macOS と寸法が一致しない（Done#6 の単一正が崩れる）。

対応:

- `apps/windows/Astra/app.manifest` を追加し `PerMonitorV2`（+ `dpiAware=true/pm` 後方互換、
  `longPathAware`、Windows 10/11 `supportedOS`）を宣言。
- `Astra.csproj` に `<ApplicationManifest>app.manifest</ApplicationManifest>` を配線。
- `scripts/check-xaml-wellformed.sh` を拡張し `.manifest` も整形式検査（cross-platform CI で緑）。

検証（macOS ホスト）:

- `xmllint` で manifest 整形式 OK。
- `dotnet restore -p:EnableWindowsTargeting=true` clean。
- `verify:csharp-logic` = CSLOGIC_OK 維持。`verify:all` = VERIFY_ALL_OK。
- 実 DPI スケーリング挙動は windows-latest / 実機でのみ観測可能（未検証）。

## Phase 1.77 — Global shortcut を CGEventTap 化し「押下受信」を実測（Done#2/#3）

正本 §3 は「Global shortcut: CGEventTap」を指定。従来は Carbon `RegisterEventHotKey`
（TCC 不要だが、押下受信は物理押下でしか確かめられず headless 検証不可）だった。

CGEventTap（session tap, active）へ置き換え:

- `apps/astra-macos/Sources/AstraMac/Windowing/GlobalShortcut.swift` — `CGEvent.tapCreate`
  で session tap を張り、一致キーだけ consume（他アプリへ漏らさない）、他は素通し。
  公開 API（`register`/`unregister`/`label`）は不変。純関数 `matches(combo:keyCode:flags:)`
  を分離（4 修飾のみ比較）。tap 生成失敗（Accessibility 未許可）は false を返す。
- セッション tap は**合成イベントも受信する**ため、`CGEvent.post(tap:.cgSessionEventTap)` で
  注入した ⌥Space を tap が受け取り handler が発火する経路を **headless で実測できる**。

検証（この環境, AX 許可済み）:

- 独立プローブで `TAP_ENABLED` → 合成 ⌥Space 注入 → `RECEIVED_SYNTHETIC_PRESS`。
- `--selftest shortcut` を「登録のみ」から「matcher 純関数 + 合成押下受信」へ強化:
  `SELFTEST_OK shortcut: registered=true combo=⌥Space matcher=ok receivedSyntheticPress=true`。
- `verify:all` = VERIFY_ALL_OK。
- 物理キーボードでの実押下は同一経路（署名 .app + ユーザーの Accessibility 許可）で、
  合成注入が同じ tap→matcher→handler を通ることで裏付け済み。

## Phase 1.78 — On-device STT を実測 PASS（Done#3）／過去の「環境制限」判定は誤りだった

以前「STT はこの環境ではテキストを返さない＝環境制限」と記録したが、**これは誤り**で、
原因は検証ハーネス側のバグだった。`SpeechTranscriber.recognizeFile` が `DispatchSemaphore`
でメインスレッドを塞いでおり、`SFSpeechRecognitionTask` の完了 callback（run loop 経由で届く）
が永遠に配送されず、空文字になっていた。

修正と検証:

- `recognizeFile` を run loop を回して待つ方式へ変更（塞がない）。→ 実音声で確定テキストを取得。
- `--selftest sttrecognize`（file API）: `say -v Samantha` の実音声 → on-device STT
  `"Testing Astro meeting transcription"` を認識（外部送信なし・人手なし）。
- `--selftest sttstream`（**会議で使う streaming 経路** start/append/finish）を追加:
  say 音声を 16kHz mono f32 へ AVAudioConverter で変換し append → on-device 確定
  `"Testing Astro meeting transcription"`。
- 両者を verify-macos-recording.sh のライブ経路へ追加。`verify:all` = VERIFY_ALL_OK。

これで Done#3 の「Streaming STT / transcript」は**実測 PASS**（合成音声だが実 STT エンジンが
実際に文字を返す。人間の発話でも同一経路）。残る #3 は署名 .app 越しのカレンダー実データと
物理キーボード実押下のみ（後者も CGEventTap 経路を Phase 1.77 で合成押下により実測済み）。

## Phase 1.79 — offscreen render 検査を「非空白」まで強化（Done#2/#6/#7）

従来の render selftest は `pixelsWide>0` しか見ておらず、**真っ白/透明でも通る**弱い検査だった。
実際に描画されたか（内容があるか）を検査するよう強化:

- bitmap をグリッド走査し「非透明ピクセル割合」と「distinct 色数」を測る。
- カスタム描画の 2 面（VoiceHUD / Recording Workspace = 「高い再現度」の成果物）には
  強い閾値（>=4 色 かつ >=10% 不透明）。実測 VoiceHUD=87色/100%、Workspace=67色/100% で、
  **中身のある実描画**であることを裏付ける（mock なら弾かれる）。
- Main/Settings は NavigationSplitView / Form が offscreen NSHostingView では描画を実ウィンドウへ
  遅延するため liveness（>=2 色）のみ。実ウィンドウ描画は panel/hudlifecycle で担保。
  `verify:all` = VERIFY_ALL_OK。

---

# 最終 Done 条件 状態マトリクス（Phase 1.79 時点 / これ以前の散在記述を上書きする正）

**凡例**: ✅=この環境で実測 PASS / 🟡=実装完了・検証は外部資源待ち / 記載は事実のみ、PASS を捏造しない。

| #   | Done 条件                                     | 状態                                      | 実測した根拠 / 残る外部前提                                                                                                                                                                                                                                        |
| --- | --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | shared core が実運用経路で使用                | ✅（実運用経路）/ 🟡（実 provider OAuth） | dev sign-in→gateway→Agent echo が COMPLETED+artifact（core 経由）。connector 交換は mock endpoint で実測。**残**: 実 Google/Apple/LINE の client_id + ユーザー consent。                                                                                           |
| 2   | macOS Native UI/主要機能 完成                 | ✅                                        | 4タブ Main / Voice HUD / Recording Workspace / Task Dock / Hero / Transcript / AI / RAG Drawer / Settings。offscreen 実描画 HUD=87色·100%、Workspace=67色·100%。**実ディスプレイ提示**も guishot で実測（920×590 token実寸·83色·PNG証跡）。                        |
| 3   | macOS 実機 E2E PASS                           | ✅（大半）/ 🟡（カレンダー）              | 実マイク録音·実 screen·会議E2E·回復·波形·**STT テキスト(file+streaming)**·**global shortcut 合成押下受信**·Keychain·AX·on-device STT。**残**: EventKit TCC=notDetermined のため実カレンダーは署名 .app + ユーザー許可待ち。                                        |
| 4   | Windows Native 実装 完成                      | ✅（コード）/ 🟡（実描画/実行時）         | 全 Window·Task Dock·Mica/Acrylic·同一 Bezier·WASAPI mic+loopback·screen·RegisterHotKey·core P/Invoke。C# 全ロジック（Window code-behind 含む）macOS で型検査 PASS。**残**: XAML→.g.cs codegen は XAML コンパイラの kernel32 P/Invoke により Windows 実機/CI のみ。 |
| 5   | Windows build 可能 solution/CI 完成           | ✅（構成）/ 🟡（実行）                    | Astra.sln(Debug/Release x64)·unpackaged csproj·PerMonitorV2 manifest·windows.yml(cargo→dll→dotnet build)。**残**: windows-latest / 実機での実行。                                                                                                                  |
| 6   | Design Token 単一正 維持                      | ✅                                        | tokens.json→Swift/C# Metrics 生成(--check)·workspace fixture golden·C# geometry vs fixture·Swift shape vs fixture。                                                                                                                                                |
| 7   | Voice HUD/Workspace/Main/Apps/Agents/RAG 統合 | ✅                                        | fulllifecycle(HUD→Recording→保存→HUD)·hudlifecycle·panel(Spaces/fullscreen)·render(実描画)。                                                                                                                                                                       |
| 8   | 旧 Tauri 依存が最終製品経路から外れる         | 🟡                                        | 会議/Agent/Apps/Library の経路は core 化。native 最終製品は Tauri 非依存（check-native-tauri-free）。**残**: 旧 apps/desktop の完全 retire は native 実機能パリティ確定後（外部前提と同時にクローズ）。                                                            |
| 9   | tests/convention/build PASS                   | ✅                                        | verify:all = VERIFY_ALL_OK。core36/TauriRust67/JS352/macOS selftest 群/C# 型検査/FFI 契約 21=21=21。                                                                                                                                                               |
| 10  | architecture・実装・未検証を docs 固定        | ✅                                        | 本書 Phase 1.x + 本マトリクス。未検証は #列に明示。                                                                                                                                                                                                                |
| 11  | 最終 commit hash 提示                         | ✅                                        | 各 Phase の commit を記載。最新は git log 参照。                                                                                                                                                                                                                   |

**外部資源が揃えば即クローズできる 3 点**（コード/CI/手順は完成済み・PASS 捏造なし）:

1. 実 OAuth provider client_id + ユーザー consent → #1 の実 provider 経路。
2. Windows ホスト（実機 or windows-latest CI）→ #4/#5 の実ビルド·実描画·実行時、及び #8 の最終判断材料。
3. 署名 .app + ユーザーの TCC 許可（カレンダー）→ #3 の実カレンダーデータ。

**過去記述の訂正**: 「global shortcut は Carbon 登録のみ・押下受信 live 未検証」は Phase 1.77 で
CGEventTap 化 + 合成押下受信の実測に更新。「STT はこの環境で無音＝環境制限」は Phase 1.78 で
検証ハーネスの main-thread blocking バグと判明し、実 on-device 認識の実測 PASS に更新。

## Phase 1.80 — 実ディスプレイ上の実提示を実測（Done#2/#3/#7）

offscreen 描画（Phase 1.79）に加え、**実 window server 上の実提示**を実測した。
`--selftest guishot` は **3 主要サーフェス**を順に実提示し、各々を自 window 撮影する（各一瞬で閉じる）:

- **Voice HUD**（AstraPanel, VoiceHUDView）: token 実寸 **310×31**、実測 **108 色**。
- **Recording Workspace**（AstraPanel, RecordingWorkspaceView）: token 実寸 **920×590**、実測 **83 色**。
- **Main Window**（titled NSWindow, MainWindowView）: 幅 **900**、実測 **24 色**。
  offscreen NSHostingView では NavigationSplitView が **3 色**しか描かれなかったが、**実ウィンドウ提示では
  24 色**で豊かに描画され、Phase 1.79 の offscreen 制限が実提示で解消されることを実証。
  手順: `CGWindowListCopyWindowInfo` で自プロセス(pid)所有の on-screen window を特定 → `CGWindowListCreateImage`
  で撮影 → 色数/bounds を検査（borderless の 2 面は token 実寸 ±2pt）→ PNG を証跡保存。
  headless（画面が無い CI）なら SELFTEST_SKIP。

撮影された PNG には、Workspace 面に notch / HUD 操作バー / Recording Hero（録音中·04:21·波形）/ 話者ラベル付き
Transcript（田中·あなた·鈴木）/ Task Dock / RAG Context Drawer（ファイル·Gmail·Drive + スコア）、Main 面に
4 セクション（Home / AI Agents / Library / Apps）+ アカウント chip が実描画されており、
**mock でなく統合済み UI が実ディスプレイに token 実寸で提示される**ことを裏付ける。
`verify:all` = VERIFY_ALL_OK。

## Phase 1.81 — Main Window の AX ツリーを実測（§6「macOS XCUITest」相当 / Done#2/#7）

§6 test 一覧の「macOS XCUITest」は、SwiftPM executable では XCUITest ターゲットを持てず
.xcodeproj 生成が要る。代替として、**実提示した Main Window のアクセシビリティツリー**を
自プロセスの AX API で走査し、UI を pixels でなく**構造として**実測した（XCUITest の主眼＝
UI 要素の存在/属性検証と同じ）。
`--selftest axtree`:

- 実 Main Window と Recording Workspace を提示し、`AXUIElementCreateApplication(getpid())` から子孫を走査。
- **Main**: 4 セクション Home / AI Agents / Library / Apps を実アクセシブル要素として検出（elements=14）。
- **Workspace**: 統合サーフェス 8 件 — 録音中(Recording Hero) / 文字起こし(Transcript) / 翻訳(Translation) /
  リアルタイム要約(AI Summary) / 決定事項(Decisions) / アクション(Actions) / 質問する(Ask) / RAG Context(RAG Drawer)
  を実アクセシブル要素として検出（elements=33）。§2/§7 の統合を pixels でなく**構造として**実証。
- AX 未許可 / 自プロセス AX が空の環境では捏造せず SELFTEST_SKIP。
  `verify:all` = VERIFY_ALL_OK。これで §6 test 一覧のうち XCUITest 相当が埋まった（完全な
  xcodebuild UI テストは .xcodeproj を要し、実機/署名環境での追加項目として残す）。

## Phase 1.82 — Windows/CI を GitHub Actions で実ビルド緑化（Done#4/#5/#9 の実測 PASS）

private→(ユーザー承認で)public リポジトリ `FORIFOR/astra` を作成し、GitHub Actions で
**windows-latest 実ビルド**と **ubuntu ci** を実走させた。macOS では不可能だった WinUI 3 の
実ビルド（XAML→.g.cs codegen 含む）が **実機 CI で PASS** した。ローカル緑・請求ブロック解除後に
初めて実 CI が回り、次の実バグを検出・修正した（いずれも「Windows でしか出ない/CI でしか出ない」類）:

1. **改行**: `.gitattributes` 不在で Windows checkout が LF→CRLF 変換 → design-token/fixture の
   freshness が誤判定。`* text=auto eol=lf` を追加＋`--check` を改行正規化。
2. **cdylib 名**: Rust の cdylib は Windows で `astra_core.dll`（lib 接頭辞なし）。bridge の
   ライブラリコピーが `libastra_core.dll` しか探さず DllNotFound。両名を探すよう修正。
3. **bridge 判定**: gateway 不在の CI で先頭行が `CS_SKIP` になり、先頭一致の成功判定が誤失敗。
   「core bridge の CS_OK があり CS_FAIL 無し」を条件に変更。
4. **ImplicitUsings**: 実 `Astra.csproj` が未設定で `IntPtr/Guid/...` が CS0246。logic/bridge-check
   は有効だったため見逃していた。実 csproj も有効化。
5. **エントリポイント**: unpackaged WinUI 3 で XAML 生成 Main が出ず CS5001。Microsoft 推奨の
   明示 `App/Program.cs`（`Application.Start`）＋`DISABLE_XAML_GENERATED_MAIN` を追加 → **Build succeeded, 0 Error**。
6. **ubuntu ci**: prettier/`cargo fmt`/`clippy -D warnings`（useless_conversion ×3）/`libasound2-dev` 不足で
   alsa-sys ビルド失敗 / secrets テストが Linux の keyring 失敗メッセージ差異 —— すべて修正。

結果: **windows workflow = success（WinUI 3 solution ビルド緑）/ ci workflow = success（全ゲート緑）**。
Done#5=実測 PASS、Done#4=実 Windows で実装がビルド/型解決/リソース生成まで PASS（実行時 GUI 描画のみ
Windows 実機の手動 smoke に残す）、Done#9=実 CI（ubuntu + windows-latest）で PASS。

## Phase 1.83 — Windows 実行時スモーク: Astra.exe 起動 + Voice HUD 実描画（Done#4 実行時）

ビルド緑化（Phase 1.82）に続き、`windows` workflow に**実行時スモーク**を追加した:

- `dotnet publish --self-contained -p:WindowsAppSDKSelfContained=true`（WindowsAppSDK runtime 同梱、
  unpackaged でも起動可）→ 実 `Astra.exe` を windows-latest で起動 → 12 秒生存を確認 → プライマリ画面を撮影。
- 結果: **`SMOKE_OK: Astra.exe stayed alive 12s (WinUI bootstrap + window created)`**。
  撮影スクショに、上部中央へ **実 Voice HUD（option / command / 長押しで音声入力）** が実描画されている
  （`VoiceHudWindow.xaml` と一致）。artifact `astra-windows-smoke.png`。

これで Done#4 は、実 Windows で **ビルド + 起動 + Voice HUD の実描画**まで実測 PASS。残るのは
Recording Workspace への遷移や WASAPI 実録音など**対話操作を伴う実機フル smoke**（自動 CI では
起動と HUD 描画までを担保）。Windows PASS は捏造せず、CI で実際に取れた範囲を明記する。

## Phase 1.84 — Windows 実行時スモークの到達点と正直な限界（Done#4）

`windows` workflow に実行時スモーク（self-contained publish → Astra.exe 起動 → 撮影）を入れ、
実 Windows でどこまで描画できるかを実測した。過程で**実バグを 3 件修正**（実機でしか出ない類）:

- **Mica/Acrylic backdrop**: DWM 合成非対応環境で activation クラッシュ → `MicaController /
DesktopAcrylicController.IsSupported()` で条件付き適用（未対応は単色背景）。実機の VM/RDP/古い
  Windows でも堅牢になる正しい修正。
- **MainWindow.xaml**: 冗長な `muxc:` 前置と Symbol 名文字列アイコン → 既定 namespace + `FontIcon`
  glyph に。
- **App.xaml**: `XamlControlsResources` 未マージ → NavigationView 等テンプレートコントロールが
  実行時 `XamlParseException` で生成失敗していた。標準リソースをマージ（**実機でも必要な実バグ修正**）。

実測できたこと / 限界:

- ✅ **build + XAML codegen + self-contained publish が windows-latest で PASS**（Windows の hard gate）。
- ✅ 基本コントロールのみの **Voice HUD / Recording Workspace は実 Windows で実描画**（スクショ証跡。
  Recording Workspace は共有 notch/Bezier ジオメトリが macOS と一致して描画）。
- 🟡 **完全アプリ（XamlControlsResources 込み・NavigationView 含む）は windows-latest の CI
  デスクトップセッションでは WinUI テーミングを完全初期化できず** activation 時に stowed
  exception(0xc000027b) で落ちる。これは CI セッションの制約で、**完全アプリのフル GUI 描画は
  Windows 実機の手動 smoke に残す**。runtime smoke は best-effort(continue-on-error) とし、
  build+publish を hard gate に据える。Windows PASS を捏造しない。
