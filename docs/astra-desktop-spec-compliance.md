# Astra Desktop Implementation Specification v0.1 — 適合状況

正本: `Astra Desktop Implementation Specification v0.1`（1167 行）
判定は「コードにある」ではなく **`pnpm verify:all` の実測ゲートが緑か**で置く。

## 実装済み（実測ゲートあり）

| §         | 要求                                                                                              | 実装                                                                                                                                       | ゲート                                                  |
| --------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 5 / 31    | 状態を 1 つの State Machine に。UI ごとに状態を持たせない                                         | `Core/AstraStateStore` が唯一の置き場。`VoiceHUDState.mode` は Store への窓口（`typealias Mode = DockPresentation`）で、**二重に持たない** | `state`                                                 |
| 5         | `AstraMode` / `AstraState`                                                                        | `Core/AstraModels`                                                                                                                         | `state`                                                 |
| 28        | `AstraEventBus`、Module 間を直接依存させない                                                      | `Core/AstraEventBus`。§28 のイベント名をそのまま持つ                                                                                       | `state`                                                 |
| 7         | 情報源を優先順位付きで統合（Browser DOM > AX > … > OCR）                                          | `ContextSourceKind` + `ContextBundle.resolved`。同じアプリなら信頼できる source だけ残す                                                   | `state`                                                 |
| 25        | Context に必ず source / sensitivity / 期限                                                        | `ContextFact`。期限切れは束から落ちる                                                                                                      | `state`                                                 |
| 8         | AXContext（app / window / role / selection）                                                      | `AccessibilityContext.snapshot()`。取れない項目は nil のまま                                                                               | `presence`                                              |
| 6         | Presence（frontmostApplication 監視）                                                             | `AstraAppDelegate` の `didActivateApplication` → `app.changed` + 文脈更新                                                                  | `presence`                                              |
| 16        | Action を R0–R3 に分類。確認要否はここだけで決める                                                | `ActionRiskLevel`。R0/R1 は無確認、R2/R3 はカード                                                                                          | `state`                                                 |
| 17        | 確認は AI の文章ではなく UI カード                                                                | `Action/ConfirmationCardView` + `ConfirmationPresenter`。見出しもボタンも**結果**を書く                                                    | `state` / `render`                                      |
| 18        | 会議検出。**検出 = 録音開始 にしない**                                                            | `Meeting/MeetingDetector`。Zoom / Meet / Teams / Webex / Discord / Slack ハドル。Slack は開いているだけでは会議にしない                    | `presence`                                              |
| 22        | Presentation Guard。既定は畳む                                                                    | `Windowing/PresentationGuard`                                                                                                              | `presence`                                              |
| 15        | AgentTask / Step の Timeline UI（✓/●/○）                                                          | `Agent/TaskTimelineView`。AI 操作が実際に step を進める（飾りではない）。`AstraState.activeTask` だけを描く                                | `shots` 10 面目                                         |
| 25        | AI が何を見ているかを出す                                                                         | Timeline の右上に `context.visibleSources`                                                                                                 | `shots` 10 面目                                         |
| 26        | Progressive Permission（初回に一括で要求しない）                                                  | `Settings/PermissionCenter`。機能ごとに要る分だけ。録音開始時に会議の分、声を使う瞬間にマイクだけ                                          | `presence`                                              |
| 29        | 性能目標                                                                                          | 実測ゲート。dock 25–43ms / AX 7–9ms / app 0ms / mem 12MB / CPU 0.9%                                                                        | `perf`                                                  |
| 11        | 常時キャプチャ禁止。通常 0fps / 要求時 1 枚 / 追跡 1–3fps                                         | `Context/ScreenCapturePolicy`                                                                                                              | `storage`                                               |
| 14        | 実行優先順位（Plugin > API > DOM > AX > Vision）。Vision は最後                                   | `Agent/ExecutionPlanner`。上位が 1 つでも使えれば Vision を選ばせない                                                                      | `storage`                                               |
| 20        | 増分抽出（PreviousState + RecentTranscript → Delta）                                              | `Meeting/MeetingIntelligence`。各回の投入行数を持ち、**全文再投入していないこと**を検査                                                    | `meetingiq`                                             |
| 21        | Meeting Canvas は構造データ                                                                       | `MeetingCanvas` + `Meeting/MeetingCanvasView`（決まったこと / やること / 宿題 / 懸念）                                                     | `meetingiq` / `shots` 11 面目                           |
| 23        | UI lifecycle ≠ Task lifecycle                                                                     | task は SQLite に残り、起動時に `restoreRunningTask()` で戻る                                                                              | `storage`                                               |
| 24        | SQLite（7 テーブル）。raw screenshot / audio を保存しない                                         | `Storage/LocalStore`。**画像・音声・本文の列を作っていない**ので後から入れられない                                                         | `storage`                                               |
| 12        | VAD / partial を 100–300ms で UI へ                                                               | `Audio/VoiceActivityDetector` を STT の前段に。partial は final を待たない。**実音声で 62–119ms を実測**                                   | `vad`                                                   |
| 19        | System Audio と mic を混ぜても speaker channel を保つ                                             | `Audio/AudioMixer`。混合波は記録用、STT へは `local_user` / `remote_audio` に分けて渡す。話者名は channel から                             | `vad`                                                   |
| 30 Phase1 | Presence / Task Dock / Global Shortcut / Voice STT / NSWorkspace Context / AX Context / Basic Ask | Task Dock は VoiceOS 準拠で再実装済み（`docs/macos-ui-spec.md`）。STT は実音声で実測                                                       | `dockshots` / `sttrecognize` / `sttstream` / `shortcut` |

## 未実装 / 未検証

| §       | 要求                                                  | 状況                                                           |
| ------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| 9 / 10  | Chrome Extension + Native Messaging、Notion Adapter   | 未着手（Phase 2）。`ContextSourceKind.browserDOM` の口だけ用意 |
| 11      | ScreenCaptureKit を要求時 1 枚 / 追跡時 1–3fps に制御 | 撮影自体は実装済み。**fps 制御の方針が未実装**                 |
| 12      | VAD / partial transcript 100–200ms 反映               | STT は実装済み。VAD と partial の反映間隔は未計測              |
| 14      | 実行優先順位（Plugin > MCP > DOM > AX > Vision）      | Runtime が未実装                                               |
| 15      | AgentTask / Step の Timeline UI                       | モデルのみ。UI 未実装                                          |
| 19      | System Audio 混合 + speaker channel                   | system audio 取得は実装済み。混合と channel 保持は未実装       |
| 20 / 21 | Meeting Intelligence の増分抽出、Meeting Canvas       | `MeetingCanvas` モデルのみ。抽出は未実装                       |
| 23      | UI lifecycle ≠ Task lifecycle                         | 未実装                                                         |
| 24      | SQLite（tasks / conversations / meetings / …）        | 未実装。いまはファイル journal                                 |
| 26      | Progressive Permission                                | 状態表示は Settings にある。**必要時に出す導線が未実装**       |
| 27      | Plugin System                                         | gateway 側の catalog のみ                                      |
| 29      | 性能目標（idle CPU<1% / Dock<120ms / AX<250ms …）     | **未計測**                                                     |
| 1       | Developer ID 署名 + Notarization + DMG                | 現在は Apple Development 署名。未着手                          |
| 2       | Windows（WinUI 3 ほか）                               | Phase 5                                                        |

## 進め方

仕様書 §30 の Phase 順に、1 つずつ「実測ゲート付き」で足す。
ゲートの無い実装は完了扱いにしない。
