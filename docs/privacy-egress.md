# 何が Mac の外へ出るか（実装から読んだ一覧、2026-09-04）

> **2026-09-04 に閉じた。**下の一覧は見つけた時点の姿。決定と、その後の姿は末尾「決めたこと」。
> 守るのは `scripts/verify-privacy-egress.sh`（PRIVACY_EGRESS_GATE、verify-all に入っている）と
> `--selftest egress`（実行体で、既定 OFF と「資産の無いロケールで throw」を確かめる）。

取扱説明書の脚注は「録音した音声・文字起こし・鍵はこの Mac の中だけで扱われ、あなたが確認して
実行したものだけが外に出ます」と言う。それが**どの条件で本当か**を、意図ではなく実装
（呼び手と条件）で一覧にする。spec §22 の label（local-only / cloud-used / external-send）で分類する。
表示の文言はまだ変えていない（この一覧が正本になってから）。

| 経路                                                         | 出るもの                                                                                                                                                                                                         | 出る条件                                                                                                                                                                                                  | 分類                                                                  | 根拠                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Apple の音声認識サーバ                                       | **会議の音声**                                                                                                                                                                                                   | `SFSpeechRecognizer(ja-JP).supportsOnDeviceRecognition == false` のとき。コードが `requiresOnDeviceRecognition` をその値にしているので、日本語のオンデバイス資産が無い Mac では**黙って**サーバ認識になる | cloud-used（利用者に見えない）                                        | `Audio/SpeechTranscriber.swift:53,93`、呼び手 `RecordingWorkspace/RecordingRuntime.swift:82`                                               |
| gateway（`ASTRA_GATEWAY_URL`、既定 `http://127.0.0.1:3000`） | 開発サインイン（`main-<pid>@astra.local`）、`/v1/me`、会議の作成・終了、**録音した音声の全断片**（WS `/v1/meetings/:id/audio`）、落ちた録音の回復送信、声で頼んだ文（`/v1/conversations/:id/turns`）、タスク作成 | gateway に到達できるとき。Main window を開くと**自動で**サインインし、録音側にも渡す。配布版は既定が 127.0.0.1 なので、利用者が何か立てていない限り到達しない                                             | cloud-used / external-send（gateway の先で何をするかは gateway 次第） | `Main/MainWindowView.swift:35-49`、`RecordingRuntime.swift:70-76,171-175,225-232`、`core/astra-core/src/api.rs:63,111,135,248,297,322,383` |
| connector の OAuth                                           | 認可コード往復（本文は出ない）                                                                                                                                                                                   | 利用者が接続操作をしたとき                                                                                                                                                                                | external-send（本人操作）                                             | `Context/ConnectorFlow.swift:9-14`                                                                                                         |
| Sparkle appcast（GitHub Releases）                           | 版・OS の情報                                                                                                                                                                                                    | 起動時 1 回、「更新を確認…」                                                                                                                                                                              | cloud-used                                                            | `App/SoftwareUpdate.swift`                                                                                                                 |
| 配布ページ / ガイドの URL                                    | なし（ブラウザを開くだけ）                                                                                                                                                                                       | 本人操作                                                                                                                                                                                                  | —                                                                     | `App/StatusBarController.swift`                                                                                                            |

## Apple 音声認識の実測（この Mac、macOS 26.6.2、2026-09-04）

`SFSpeechRecognizer` の `supportsOnDeviceRecognition` はロケールごとに違う。この Mac では
**ja-JP と en-US だけ true**、en-GB / zh-CN / ko-KR / de-DE / fr-FR / es-ES / vi-VN / th-TH /
id-ID / hi-IN / tr-TR / uk-UA / ms-MY / he-IL は `available=true, onDevice=false`
（ログは "No Assistant asset for language …"）。つまり「対応していない Mac」ではなく
「その言語のオンデバイス資産が入っていない Mac」で起きる。日本語の資産が入っていない
Mac（英語環境の Mac など）で Astra を使うと、この列に ja-JP が入る。

`say` で作った 2.75 秒の音声を de-DE（onDevice=false）で認識させた結果:

| `requiresOnDeviceRecognition` | 結果                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| true                          | 即座に error `Failed to access assets`（kLSRErrorDomain 102）。文字は出ない                 |
| false                         | `Guten Morgen wie teuer die hat` が返る——資産が無いのに認識できた＝**サーバで認識している** |

Astra のコードは後者の設定になる（`= recognizer.supportsOnDeviceRecognition`）。
Info.plist の `NSSpeechRecognitionUsageDescription` は「音は端末から出しません」と言っている
（`scripts/release-macos.sh:132`）。**この 2 つは両立しない。**

決めること（→ A に決めた。末尾）: A = `requiresOnDeviceRecognition = true` を固定し、資産が無ければ
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

## 決めたこと（2026-09-04、本人の決定）

1. **STT は黙ってクラウドへ落とさない。** `requiresOnDeviceRecognition = true` を固定
   （`Audio/SpeechTranscriber.swift:74,115`）。資産が無いロケールでは `start` が code 3 で throw し
   （`:68-69`）、`recognizeFile` は nil。**エラー後に false で取り直さない。**録音は続き、Workspace の
   本文が「この Mac ではオンデバイス文字起こしを使えません。音声は保存されています」と言う
   （`RecordingWorkspaceView.swift:494`、`Facts.transcriptionOnDeviceUnavailable`、ガイド §7 に行を足した）。
   クラウド文字起こしを足すなら「音声が外部サービスへ送信されます」と言う別の opt-in 機能として作る。
   実測: ar-SA（資産無し）で `start=code3 file=nil`（`--selftest egress`）。
2. **録音の自動 upload は既定 OFF、dev 専用。** `MainData.load()` は録音側（`RecordingRuntime`）に
   gateway を渡さない。渡すのは `RecordingRuntime.devAutoUploadEnabled`（`#if DEBUG` かつ
   `ASTRA_DEV_AUTO_UPLOAD=1`）のときだけ（`Main/MainWindowView.swift:51`）。release ビルドには道が無い。
   会議の作成・停止時の音声送信・落ちた録音の自動回収は、その旗の中でしか起きない。
   selftest（e2e001 / recovery / fulllifecycle …）は `configureBackend` を自分で呼ぶので影響しない。
   AI 操作・翻訳・声で頼む（文字を gateway へ送る）は人が押してから動くので残す。
3. **`.meeting` はマイクだけ求める**（`Settings/PermissionCenter.swift`）。system audio は本番経路で
   取り込んでいないので、画面収録を求める理由が無かった。本当に繋いだ日に「相手の声も記録する」の
   入口で JIT で求める（Permission B は別途作らない）。ガイドの「（相手の声のために）画面収録」は消した。

負例で確かめたこと（gate が落ちる）: `requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition`
に戻す → FAIL、`RecordingRuntime.shared.configureBackend` を旗の外へ出す → FAIL、
`.meeting` に `.screenRecording` を戻す → FAIL。

## 残す実機確認（Privacy とは別の gate: Meeting Capture Reality）

`.meeting` をマイクだけにしたので、Privacy は PASS でも**会議の録れ方**は別に確かめる（本人の指示、2026-09-04）。
実際の Meet / Zoom で、スピーカー再生の状態で 1 度録って次を見る:

```
MEETING_CAPTURE_REALITY
  local mic                captured   （自分の声が文字起こしに出る）
  remote speaker           captured   （相手の声がマイク経由で拾えている / 拾えていない）
  system audio             captured   （いまは未接続なので NOT_CAPTURED が正直。繋いだら再測定）
  screen permission        not required（録音開始で画面収録のダイアログが出ない）
```

相手の声が拾えないなら、それは system audio（ScreenCaptureKit / 仮想デバイス）を繋ぐ課題で、
繋いだ時点で `.meeting` の JIT に「相手の声も記録する」として 画面収録 を戻す（`verify-privacy-egress.sh` は
`captureSystemAudio: true` と `.screenRecording` が**両方**あるときだけそれを PASS にする）。
自分では実会議を開けないので、この 4 行は本人の実機で。

## カレンダーは「予定が出る場所」で求める（CALENDAR_PURPOSE_FIRST、2026-09-04）

決める前の状態: カレンダーの許可を求める場所は設定の「権限」の 1 行だけで（`Settings/SettingsView.swift:35`）、
Home は `.onAppear` で黙って読み、未確認なら「これからの予定」の節ごと消えていた。求めてはいないが、
**この機能があることを知る道が無い**（設定を開いた人だけが気づく）。spec §21「Permission missing:
理由 + Connect」§22「利用直前に purpose-first」に対して、理由も入口も無かった。

決めたこと:

1. **求める場所は Home の「これからの予定」の場所**。未確認のときだけ、予定の代わりに
   「予定から録音を始める — これからの会議をここに出すにはカレンダーの許可が要ります。[カレンダーを許可 →]」
   の行を出す（`Home/HomeView.swift` `calendarAskRow`、識別子 `askCalendar`）。押したときだけ OS のダイアログ。
   Home を開いた瞬間には出さない。
2. **拒否されたら二度と聞かない。** 拒否・制限ではこの行を出さない。再許可は設定の「権限」から
   （行はそのまま）。
3. **予定を読む分だけ求める。** `PermissionCenter.Capability.schedule` は `[.calendar]` だけ。録音のマイクは
   `.meeting` が録音開始で別に求める（巻き込まない）。
4. 許可が下りたらその場で予定を読み直す（`HomePane.loadUpcoming`、`onCalendarGranted`）。

gate（`--selftest calendarask`、`verify-macos-recording.sh` と `verify-release-artifact.sh` の一覧に入れた）:

```
CALENDAR_PURPOSE_FIRST
  schedule.required == [calendar]         PASS
  notDetermined → askCalendar + reason     PASS（自プロセス AX で識別子と文を確認）
  granted / denied → askCalendar 無し      PASS
  起動経路で求めていない                    PERMISSION_JIT_OK（HomeView は許可一覧に理由つきで載っている）
```

この Mac は許可済みなので、未確認・拒否は `Permissions.simulatedCalendar`（`simulatedMicrophone` と同じ型）で作る。
**実 TCC ダイアログが出て、許可直後に予定が並ぶ**ところは署名 .app + 未確認の端末でしか確かめられない
（`--selftest calendarlive` と同じ制約、NOT_MEASURED）。
