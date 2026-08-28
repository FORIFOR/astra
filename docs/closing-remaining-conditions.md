# 残り 3 条件のクローズ手順（turnkey runbook）

Phase 1.81 時点。この環境で実測できるものは全て緑（`pnpm verify:all` = VERIFY_ALL_OK）。
残る 3 条件は**物理的に不在の外部資源**のみを要する。各々、資源が入れば以下の手順でそのまま
クローズできる（新規実装は不要。コード・CI・手順は完成済み・PASS は捏造していない）。

---

## A. #4/#5 — Windows 実ビルド・実描画・実行時（要: Windows ホスト）

> **実機フル GUI(#4) の手順（2026-08-28 整備）**: `windows` workflow が self-contained アプリを
> artifact `astra-windows-app`（`publish/` 一式 = Astra.exe + WindowsAppSDK ランタイム）として出力する。
>
> 1. GitHub Actions の最新 `windows` run から `astra-windows-app` を Windows 実機にダウンロードして展開。
> 2. `Astra.exe` を実行し、以下を目視（最大 5 項目）:
>    - **Voice HUD**（上部中央・borderless・option/command/長押しで音声入力）
>    - **Recording Workspace**（`Astra.exe --smoke-workspace`。notch/Bezier・Task Dock・録音中 Hero）
>    - **Main Window**（`Astra.exe --smoke-main`。NavigationView 4 セクション Home/AI Agents/Library/Apps）
>    - **Task Dock / notch geometry** が tokens 実寸で描かれる
>    - 録音終了 → HUD 復帰の遷移
> 3. スクショか結果を戻せば #4 クローズ。
>    CI(windows-latest) セッションは WinUI コントロールリソースを完全初期化できず完全アプリは落ちるため、
>    このフル GUI だけは実機目視に残す（build+publish は CI で PASS 済み・HUD/Workspace は CI で実描画済み）。

**なぜこの環境で不可**: WinUI の XAML→`.g.cs` codegen は XAML コンパイラ(net472 exe)が
`kernel32.dll` を P/Invoke するため、macOS では実行できない（Phase 1.5x で根本原因を実測確定）。
C# 全ロジック（Window code-behind 含む）は macOS で型検査 PASS 済み。

**クローズ手順**:

1. `apps/windows/**` を含むコミットを push（または GitHub Actions で `windows` workflow を手動実行）。
   - `.github/workflows/windows.yml` が windows-latest で自動実行する:
     `cargo build --release`（astra_core.dll）→ dll を配置 → `check-cabi-csharp` →
     `verify-csharp-bridge` → `check-xaml-wellformed` → `verify-csharp-logic` →
     `dotnet build apps/windows/Astra.sln -c Release -p:Platform=x64`。
2. 緑になれば #5 クローズ。実描画/実行時（#4 の残り）は実機で `Astra.exe` を起動し、
   Voice HUD → ⌥相当のショートカット → Recording Workspace の遷移を目視。
3. 期待寸法: HUD/Workspace は tokens 由来（`GeneratedMetrics.cs`、`--check` で macOS と同一）。
   PerMonitorV2 manifest 済みなので高 DPI でも token 実寸で描かれる。

## B. #1/#8 — 実 OAuth provider（要: 実 client_id + ユーザー consent）

**現状**: 交換 HTTP・PKCE・callback ガードは実 HTTP（ローカル mock endpoint）で実測済み
（`docs/evidence/oauth.md`、`--selftest connectorexchange`）。dev sign-in→gateway→Agent は
実運用経路で COMPLETED 実測済み（#1 の実運用経路は達成）。残るは実 provider のみ。

**クローズ手順**:

1. `.env` に Desktop 用 OAuth client を設定: `ASTRA_AUTH_GOOGLE_CLIENT_IDS=<client_id>`
   （Apple web / LINE を使うなら加えて `ASTRA_PUBLIC_URL`(https) と relay）。
2. gateway を起動（compose）。アプリでその client を使って一度サインイン。
3. `oauth_providers` の名乗りが `unverified → verified` に変わる（両状態は実測済み: 接続無→
   unverified→起動不可 / 接続有→verified→起動可）。これで #1 実 provider・#8 の該当分クローズ。
   - 注意（方針）: 本人の Google は Final Acceptance まで触らない。開発検証は専用テスト
     アカウントで。refresh/device トークンは Keychain の外（Cloud/DB）へ出さない。

## C. #3 — カレンダー実データ（要: 署名 .app + ユーザーの TCC 許可）

> **この環境での実測(2026-08-28)**: 署名 .app を作成し（`scripts/package-macos-app.sh`、
> Apple Development / com.astra.desktop / Team 6RR7572ZLU）、`open` 経由で `--selftest calendarlive`
> を実行した。`EventKit.requestFullAccessToEvents` の completion handler が **180 秒たっても発火せず**
> （`callbackFired=false`）、`com.apple.TCC` ログにもプロンプト提示の記録が無い。この macOS セッションは
> **対話的 TCC プロンプトを出せない自動化セッション**で、mic/AppleEvents は TCC.db 直書きで seed 済み
> （`kTCCServiceMicrophone|com.astra.desktop|2`）だが Calendar は未 seed。TCC.db 直書きは
> セキュリティ設定変更かつ同意の捏造になるため行わない。→ **external verification pending**。
> コード・署名 .app・実 request/read フローは完成。実対話セッション（人が TCC を許可できる macOS ログイン）
> があれば下記手順でそのままクローズできる。

**なぜこの環境で不可**: EventKit の認可が `notDetermined`。実データ取得は
`requestFullAccessToEvents` のプロンプト許可が要る（mic/screen/speech/AX は付与済みだが
カレンダーは未付与）。状態読み取り・無許可時 空（捏造なし）は実測済み（`--selftest calendar`）。

**クローズ手順**:

1. `apps/astra-macos` を署名して .app 化し起動（Info.plist に `NSCalendarsFullAccessUsageDescription`）。
2. 初回にカレンダー許可プロンプトでユーザーが許可。
3. `CalendarAccess.upcoming(hours:)` が実イベントを返す（`--selftest calendar` が
   `status=許可済み upcoming=N` を表示）。これで #3 の残り（カレンダー実データ）クローズ。

---

## クローズ後に #10/#11 を更新

3 条件クローズ後、`docs/astra-core-migration.md` の状態マトリクスを ✅ 更新し、最終 commit hash を提示する。
