# 何が Mac の外へ出るか（実装から読んだ一覧、2026-09-04）

取扱説明書の脚注は「録音した音声・文字起こし・鍵はこの Mac の中だけで扱われ、あなたが確認して
実行したものだけが外に出ます」と言う。それが**どの条件で本当か**を、意図ではなく実装
（呼び手と条件）で一覧にする。spec §22 の label（local-only / cloud-used / external-send）で分類する。
表示の文言はまだ変えていない（この一覧が正本になってから）。

| 経路 | 出るもの | 出る条件 | 分類 | 根拠 |
|---|---|---|---|---|
| Apple の音声認識サーバ | **会議の音声** | `SFSpeechRecognizer(ja-JP).supportsOnDeviceRecognition == false` のとき。コードが `requiresOnDeviceRecognition` をその値にしているので、日本語のオンデバイス資産が無い Mac では**黙って**サーバ認識になる | cloud-used（利用者に見えない） | `Audio/SpeechTranscriber.swift:53,93`、呼び手 `RecordingWorkspace/RecordingRuntime.swift:82` |
| gateway（`ASTRA_GATEWAY_URL`、既定 `http://127.0.0.1:3000`） | 開発サインイン（`main-<pid>@astra.local`）、`/v1/me`、会議の作成・終了、**録音した音声の全断片**（WS `/v1/meetings/:id/audio`）、落ちた録音の回復送信、声で頼んだ文（`/v1/conversations/:id/turns`）、タスク作成 | gateway に到達できるとき。Main window を開くと**自動で**サインインし、録音側にも渡す。配布版は既定が 127.0.0.1 なので、利用者が何か立てていない限り到達しない | cloud-used / external-send（gateway の先で何をするかは gateway 次第） | `Main/MainWindowView.swift:35-49`、`RecordingRuntime.swift:70-76,171-175,225-232`、`core/astra-core/src/api.rs:63,111,135,248,297,322,383` |
| connector の OAuth | 認可コード往復（本文は出ない） | 利用者が接続操作をしたとき | external-send（本人操作） | `Context/ConnectorFlow.swift:9-14` |
| Sparkle appcast（GitHub Releases） | 版・OS の情報 | 起動時 1 回、「更新を確認…」 | cloud-used | `App/SoftwareUpdate.swift` |
| 配布ページ / ガイドの URL | なし（ブラウザを開くだけ） | 本人操作 | — | `App/StatusBarController.swift` |

## Apple 音声認識の実測（この Mac、macOS 26.6.2、2026-09-04）

`SFSpeechRecognizer` の `supportsOnDeviceRecognition` はロケールごとに違う。この Mac では
**ja-JP と en-US だけ true**、en-GB / zh-CN / ko-KR / de-DE / fr-FR / es-ES / vi-VN / th-TH /
id-ID / hi-IN / tr-TR / uk-UA / ms-MY / he-IL は `available=true, onDevice=false`
（ログは "No Assistant asset for language …"）。つまり「対応していない Mac」ではなく
「その言語のオンデバイス資産が入っていない Mac」で起きる。日本語の資産が入っていない
Mac（英語環境の Mac など）で Astra を使うと、この列に ja-JP が入る。

`say` で作った 2.75 秒の音声を de-DE（onDevice=false）で認識させた結果:

| `requiresOnDeviceRecognition` | 結果 |
|---|---|
| true | 即座に error `Failed to access assets`（kLSRErrorDomain 102）。文字は出ない |
| false | `Guten Morgen wie teuer die hat` が返る——資産が無いのに認識できた＝**サーバで認識している** |

Astra のコードは後者の設定になる（`= recognizer.supportsOnDeviceRecognition`）。
Info.plist の `NSSpeechRecognitionUsageDescription` は「音は端末から出しません」と言っている
（`scripts/release-macos.sh:132`）。**この 2 つは両立しない。**

決めること（未決）: A = `requiresOnDeviceRecognition = true` を固定し、資産が無ければ
「この Mac では日本語のオンデバイス文字起こしが使えません」と明示して録音だけ続ける
（spec §21 "Meeting STT degraded: 録音は継続中"）。B = サーバ利用を許し、ガイドと UI で
「必要な場合は Apple の音声認識を利用」と正確に表示する。

## 相手の声（system audio）について

`RecordingWorkspaceState.start()` は `RecordingRuntime.begin(meetingId:)` を既定引数で呼ぶので
`captureSystemAudio: false`。**製品の録音は相手の声（画面の音）を一度も取り込んでいない**。
「System Audio: On」の切り替え（`Home/NewRecordingSheet.swift:12`）は保存されるだけで、
読む側が無い。一方 `.meeting` は録音開始時に「相手の音声のために」画面収録を求める
（`Settings/PermissionCenter.swift:24,33`）。使わない許可を求めている。
画面収録が実際に要るのは、Workspace の「スキャン」（`captureScreenshot()`）と画面について答える
`.screenAsk` だけ。
