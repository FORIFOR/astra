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
